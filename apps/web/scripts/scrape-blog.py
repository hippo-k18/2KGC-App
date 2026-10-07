#!/usr/bin/env python3
"""
Pull the full text of every blog post off the live WordPress and check it in.

`src/lib/posts.ts` already holds each post's title, date, author, categories,
tags and excerpt. This fills in the rest: the article body, the images inside
it, and the author box (avatar and bio) that sits under every post.

Writes:
  src/content/blog/<slug>.html     the cleaned body, one file per post
  src/content/blog/authors.json    author name -> avatar path and bio
  public/kgc/blog/content/<slug>/  every image and small file the bodies use
  public/kgc/blog/authors/         the author avatars

Cleaning is an allowlist, not a blocklist. WordPress markup arrives wrapped
in inline styles, theme classes and tracking attributes. What survives is plain
document structure plus three classes the stylesheet knows: `center`, `button`
and `embed`. YouTube iframes are kept, switched to youtube-nocookie.com and
wrapped in a 16:9 box; any other iframe is dropped. Links back into
knowledgegraph.tech are rewritten to the path the new site serves, using the
same `url-map.csv` the redirects came from, so a post never sends a reader back
to the old domain for something that exists here.

Run from `apps/web`:  python3 scripts/scrape-blog.py
Needs network and BeautifulSoup (`pip install beautifulsoup4`). Re-running is
safe: files are overwritten and downloads already on disk are skipped.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, Comment, Tag

LIVE = 'https://www.knowledgegraph.tech'
API = f'{LIVE}/wp-json/wp/v2'
UA = 'Mozilla/5.0 (KGC site migration)'

WEB = Path(__file__).resolve().parent.parent
CONTENT = WEB / 'src' / 'content' / 'blog'
PUBLIC = WEB / 'public'
MEDIA = PUBLIC / 'kgc' / 'blog' / 'content'
AVATARS = PUBLIC / 'kgc' / 'blog' / 'authors'
URL_MAP = WEB.parent.parent.parent / 'url-map.csv'

# Anything bigger stays on the live site rather than bloating the repo.
MAX_DOWNLOAD = 8 * 1024 * 1024

ALLOWED = {
    'p', 'a', 'b', 'strong', 'em', 'i', 'u', 'br', 'hr',
    'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'cite',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'figure', 'figcaption', 'iframe', 'video', 'source',
}
DROP_WITH_CONTENTS = {'script', 'style', 'noscript', 'form', 'input', 'button', 'svg'}
KEEP_ATTRS = {
    'a': {'href'},
    'img': {'src', 'alt', 'width', 'height'},
    'iframe': {'src', 'title'},
    'video': {'src', 'controls', 'width', 'height', 'poster'},
    'source': {'src', 'type'},
    'td': {'colspan', 'rowspan'},
    'th': {'colspan', 'rowspan'},
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def get_json(url: str):
    return json.loads(get(url))


def paged(endpoint: str, fields: str) -> list[dict]:
    out, page = [], 1
    while True:
        batch = get_json(f'{API}/{endpoint}?per_page=100&page={page}&_fields={fields}')
        out += batch
        if len(batch) < 100:
            return out
        page += 1


def norm(url: str) -> str:
    """`https://www.x.tech/a/b/?q` and `http://x.tech/a/b` compare equal."""
    parts = urllib.parse.urlsplit(url)
    host = parts.netloc.lower().removeprefix('www.')
    return f'{host}{parts.path.rstrip("/")}'


def load_url_map() -> dict[str, str]:
    mapping = {}
    with URL_MAP.open(newline='') as fh:
        for row in csv.DictReader(fh):
            if row.get('new_path'):
                mapping[norm(row['old_url'])] = row['new_path']
    return mapping


class Migrator:
    def __init__(self, slugs: set[str], tags: dict[str, str], categories: dict[str, str]):
        self.slugs = slugs
        self.tags = tags
        self.categories = categories
        self.url_map = load_url_map()
        self.kept_remote: set[str] = set()
        self.unmapped: set[str] = set()

    # -- links -------------------------------------------------------------

    def rewrite_href(self, href: str, slug: str) -> str:
        href = href.strip()
        parts = urllib.parse.urlsplit(href)
        if parts.netloc.lower().removeprefix('www.') != 'knowledgegraph.tech':
            return href

        path = parts.path
        m = re.fullmatch(r'/blog/([^/]+)/?', path)
        if m and m.group(1) in self.slugs:
            return f'/blog/{m.group(1)}' + (f'#{parts.fragment}' if parts.fragment else '')
        m = re.fullmatch(r'/(?:blog/)?tag/([^/]+)/?', path)
        if m and m.group(1) in self.tags:
            return '/blog?tag=' + urllib.parse.quote(self.tags[m.group(1)])
        m = re.fullmatch(r'/(?:blog/)?category/([^/]+)/?', path)
        if m and m.group(1) in self.categories:
            return '/blog?category=' + urllib.parse.quote(self.categories[m.group(1)])
        if path.startswith('/wp-content/uploads/'):
            return self.download(href, slug) or href

        mapped = self.url_map.get(norm(href))
        if mapped:
            return mapped
        self.unmapped.add(href)
        return href

    # -- media -------------------------------------------------------------

    def download(self, url: str, slug: str) -> str | None:
        """Save a live-site file under `public/`, returning its site path."""
        clean = url.split('?')[0]
        name = urllib.parse.unquote(clean.rsplit('/', 1)[-1])
        name = re.sub(r'[^A-Za-z0-9._-]+', '-', name) or hashlib.sha1(clean.encode()).hexdigest()[:12]
        dest = MEDIA / slug / name
        if not dest.exists():
            try:
                req = urllib.request.Request(clean, headers={'User-Agent': UA}, method='HEAD')
                with urllib.request.urlopen(req, timeout=30) as res:
                    size = int(res.headers.get('Content-Length') or 0)
                if size > MAX_DOWNLOAD:
                    self.kept_remote.add(f'{clean} ({size // 1024 // 1024} MB)')
                    return None
                data = get(clean)
            except Exception as exc:  # a dead image should not stop the run
                self.kept_remote.add(f'{clean} ({exc})')
                return None
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        return '/' + dest.relative_to(PUBLIC).as_posix()

    # -- body --------------------------------------------------------------

    def clean(self, html: str, slug: str) -> str:
        soup = BeautifulSoup(html, 'html.parser')

        for node in soup.find_all(string=lambda s: isinstance(s, Comment)):
            node.extract()
        for tag in soup.find_all(DROP_WITH_CONTENTS):
            tag.decompose()
        for tag in soup.select('.kt_simple_share_container, .sharedaddy'):
            tag.decompose()

        for tag in soup.find_all(True):
            if not isinstance(tag, Tag) or tag.parent is None:
                continue
            self.clean_tag(tag, slug)

        # Paragraphs that held only a non-breaking space or an unwrapped span.
        for p in soup.find_all('p'):
            if not p.get_text(strip=True) and not p.find(['img', 'iframe', 'video', 'br']):
                p.decompose()

        out = str(soup)
        out = re.sub(r'\n{3,}', '\n\n', out).strip()
        return out + '\n'

    def clean_tag(self, tag: Tag, slug: str) -> None:
        name = tag.name
        style = (tag.get('style') or '').replace(' ', '').lower()
        classes = tag.get('class') or []
        centered = 'text-align:center' in style or 'aligncenter' in classes or 'has-text-align-center' in classes
        is_button = 'button' in classes or 'wp-block-button__link' in classes

        if name == 'h1':
            tag.name = name = 'h2'
        if name not in ALLOWED:
            # A centered wrapper `div` carries its alignment to its paragraphs.
            if centered:
                for child in tag.find_all(['p', 'h2', 'h3', 'h4'], recursive=False):
                    child['class'] = ['center']
            tag.unwrap()
            return

        keep = KEEP_ATTRS.get(name, set())
        for attr in list(tag.attrs):
            if attr not in keep:
                del tag[attr]

        new_classes = []
        if centered and name in {'p', 'h2', 'h3', 'h4', 'img', 'figure'}:
            new_classes.append('center')
        if is_button and name == 'a':
            new_classes.append('button')
        if new_classes:
            tag['class'] = new_classes

        if name == 'a' and tag.get('href'):
            href = self.rewrite_href(tag['href'], slug)
            tag['href'] = href
            if href.startswith('http'):
                tag['rel'] = 'noopener noreferrer'
        elif name == 'img':
            src = tag.get('src', '')
            # WordPress serves `-300x200` thumbnails in the body; ask for the original.
            full = re.sub(r'-\d+x\d+(\.\w+)$', r'\1', src.split('?')[0])
            local = self.download(full, slug) or self.download(src, slug)
            if local:
                tag['src'] = local
            tag['loading'] = 'lazy'
            tag['decoding'] = 'async'
            if 'alt' not in tag.attrs:
                tag['alt'] = ''
        elif name == 'iframe':
            src = tag.get('src', '')
            if 'youtube.com/embed/' not in src:
                tag.decompose()
                return
            vid = src.split('youtube.com/embed/')[1].split('?')[0]
            tag.attrs = {
                'src': f'https://www.youtube-nocookie.com/embed/{vid}',
                'title': tag.get('title') or 'YouTube video',
                'loading': 'lazy',
                'allow': 'accelerometer; encrypted-media; gyroscope; picture-in-picture',
                'allowfullscreen': '',
            }
            wrapper = tag.wrap(BeautifulSoup('', 'html.parser').new_tag('div'))
            wrapper['class'] = ['embed']
        elif name in {'video', 'source'} and tag.get('src'):
            local = self.download(tag['src'].split('?')[0], slug)
            if local:
                tag['src'] = local
            if name == 'video':
                tag['controls'] = ''
                tag['preload'] = 'metadata'


def author_avatars(posts: list[dict]) -> dict[int, str]:
    """
    The avatars the live site shows are custom uploads that the REST API does
    not expose (it returns Gravatar URLs), so read them off one live post per
    author.
    """
    out: dict[int, str] = {}
    for post in posts:
        if post['author'] in out:
            continue
        html = get(post['link']).decode('utf-8', 'replace')
        m = re.search(r'entry-author-avatar">\s*<img[^>]+src=\'([^\']+)\'', html)
        if m:
            out[post['author']] = re.sub(r'-\d+x\d+(\.\w+)$', r'-160x160\1', m.group(1))
    return out


def main() -> int:
    print('Fetching posts, tags, categories and authors…')
    posts = paged('posts', 'id,slug,link,author,content')
    tags = {t['slug']: t['name'] for t in paged('tags', 'slug,name')}
    categories = {c['slug']: c['name'] for c in paged('categories', 'slug,name')}
    users = {u['id']: u for u in paged('users', 'id,name,description')}

    migrator = Migrator({p['slug'] for p in posts}, tags, categories)
    CONTENT.mkdir(parents=True, exist_ok=True)

    for n, post in enumerate(posts, 1):
        body = migrator.clean(post['content']['rendered'], post['slug'])
        (CONTENT / f'{post["slug"]}.html').write_text(body)
        print(f'  [{n:>2}/{len(posts)}] {post["slug"]}')

    print('Fetching author avatars…')
    avatars = author_avatars(posts)
    AVATARS.mkdir(parents=True, exist_ok=True)
    authors = {}
    for uid, user in users.items():
        name = BeautifulSoup(user['name'], 'html.parser').get_text()
        avatar = None
        if uid in avatars:
            src = avatars[uid]
            dest = AVATARS / urllib.parse.unquote(src.rsplit('/', 1)[-1])
            try:
                if not dest.exists():
                    dest.write_bytes(get(src))
                avatar = '/' + dest.relative_to(PUBLIC).as_posix()
            except Exception as exc:
                print(f'  avatar failed for {name}: {exc}')
        bio = BeautifulSoup(user['description'], 'html.parser').get_text(' ', strip=True)
        authors[name] = {'avatar': avatar, 'bio': bio}
    (CONTENT / 'authors.json').write_text(json.dumps(authors, indent=2, ensure_ascii=False) + '\n')

    print(f'\nWrote {len(posts)} bodies and {len(authors)} authors.')
    if migrator.kept_remote:
        print(f'\nLeft on the live site ({len(migrator.kept_remote)}):')
        for line in sorted(migrator.kept_remote):
            print('  ' + line)
    if migrator.unmapped:
        print(f'\nknowledgegraph.tech links with no new path ({len(migrator.unmapped)}):')
        for href in sorted(migrator.unmapped):
            print('  ' + href)
    return 0


if __name__ == '__main__':
    sys.exit(main())
