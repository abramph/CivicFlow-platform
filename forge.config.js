module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Unestra",
    icon: "build/icon",
    ignore: [
      /tools[\\/]private\.pem$/,
      /tools[\\/]generate-license\.js$/,
    ],
  },

  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"]
    }
  ]
};
