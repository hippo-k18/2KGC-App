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
 *    SceneDelegate that starts React Native in the scene's window instead, and
 *    forwards links opened while the app runs to `RCTLinkingManager`.
 *
 * 2. `xcodebuild` fails because the AsyncStorage pod's resource bundle declares
 *    iOS 13.4 and Xcode 27 supports 15.0 and up. A Podfile `post_install` step
 *    lifts every pod below 15.1 (the app's own minimum) to 15.1.
 *
 * Both survive `expo prebuild --clean` because they are applied here rather
 * than by editing `ios/`. Remove this plugin once Expo's template adopts scenes.
 */
const { withAppDelegate, withInfoPlist, withPodfile } = require('expo/config-plugins');

const SCENE_DELEGATE = `
// Added by plugins/with-ios-scene-lifecycle.js: iOS 27 requires the UIScene lifecycle.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
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
