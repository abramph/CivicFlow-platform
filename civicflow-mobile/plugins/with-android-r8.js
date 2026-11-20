// Expo SDK 54 Android release build optimization.
// Expo's generated Android Gradle template reads this property to enable R8.
// Keep the change in a config plugin because android/ is generated during EAS prebuild.
const { withGradleProperties } = require("expo/config-plugins");

module.exports = function withAndroidR8(config) {
  return withGradleProperties(config, (config) => {
    const key = "android.enableProguardInReleaseBuilds";
    config.modResults = config.modResults.filter(
      (entry) => !(entry.type === "property" && entry.key === key)
    );
    config.modResults.push({ type: "property", key, value: "true" });
    return config;
  });
};
