module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "CivicFlow",
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
