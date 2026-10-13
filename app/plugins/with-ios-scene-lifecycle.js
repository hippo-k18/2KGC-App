/**
 * Make the generated iOS project launch when built with Xcode 27 (iOS 27 SDK).
 *
 * Two things in Expo SDK 54's native template stop that build (found in T208,
 * 2026-10-12, building for the iOS 27 Simulator):
 *
 * 1. The app crashes on launch with EXC_BREAKPOINT in
 *    `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. From the
 *    iOS 27 SDK on, UIKit refuses an app that does not adopt the UIScene
 *    lifecycle, and SDK 54's AppDelegate still makes its own window in
 *    `didFinishLaunching`. This plugin declares a scene manifest and adds a
 *    SceneDelegate, a subclass of Expo's own `ExpoAppSceneDelegate` (new in SDK
 *    57), that starts React Native in the scene's window instead.
 *
 *    Cold-start links (T240/T241): on iOS, expo-router reads the URL the app
 *    was opened with from expo-linking's `getLinkingURL()`, which is set only
 *    when the app delegate's `application(_:open:options:)` reaches Expo's
 *    subscribers. Under scenes UIKit never calls that method, and a
 *    hand-written SceneDelegate that only passed the URL in `launchOptions`
 *    (React Native's `getInitialURL`) left `kgc://community/<id>` opening Home.
 *    `ExpoAppSceneDelegate` forwards the cold-start URL, later links, user
 *    activities and life-cycle events to the app delegate, so both
 *    expo-linking and `RCTLinkingManager` hear them.
 *
 * 2. `xcodebuild` fails because the AsyncStorage pod's resource bundle declares
 *    iOS 13.4 and Xcode 27 supports 15.0 and up. A Podfile `post_install` step
 *    lifts every pod below 15.1 (the app's own minimum) to 15.1.
 *
 * Both survive `expo prebuild --clean` because they are applied here rather
 * than by editing `ios/`. Still needed on SDK 57 (checked 2026-10-12, T222):
 * its AppDelegate template makes the window the same way. Remove this plugin
 * once Expo's template adopts scenes. Expo Go is unaffected; it is Expo's own
 * binary, and this only changes builds made from this project.
 */
const { withAppDelegate, withInfoPlist, withPodfile } = require('expo/config-plugins');

const SCENE_DELEGATE = `
// Added by plugins/with-ios-scene-lifecycle.js: iOS 27 requires the UIScene lifecycle.
// Expo's scene delegate makes the window, starts React Native in it, and hands
// links (cold start included) and life-cycle events to the app delegate's
// subscribers, which is where expo-linking records the URL the app opened with.
class SceneDelegate: ExpoAppSceneDelegate {}

extension AppDelegate: ExpoReactNativeFactoryProvider {}
`;

const WINDOW_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;

function withSceneDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-lifecycle: expected a Swift AppDelegate');
    }
    if (!src.includes('class SceneDelegate')) {
      if (!WINDOW_BLOCK.test(src)) {
        throw new Error('with-ios-scene-lifecycle: the AppDelegate template changed; update the plugin');
      }
      src = src.replace(
        WINDOW_BLOCK,
        '    // The window is made by SceneDelegate (iOS 27 requires the UIScene lifecycle).\n',
      );
      src += SCENE_DELEGATE;
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

const POD_TARGET_FIX = `
    # Added by plugins/with-ios-scene-lifecycle.js: Xcode 27 supports iOS 15.0+,
    # and some pods (AsyncStorage's resource bundle) still declare 13.4.
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |c|
        if c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.1
          c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end
`;

function withPodDeploymentTarget(config) {
  return withPodfile(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('with-ios-scene-lifecycle')) {
      src = src.replace(/post_install do \|installer\|\n/, (m) => m + POD_TARGET_FIX);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = (config) => withPodDeploymentTarget(withSceneManifest(withSceneDelegate(config)));
