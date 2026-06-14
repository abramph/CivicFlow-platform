const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function getLogoAssetPath() {
  const userData = app.getPath("userData");
  return path.join(userData, "assets", "logo.png");
}

function persistLogo(base64OrPath) {
  const logoPath = getLogoAssetPath();
  fs.mkdirSync(path.dirname(logoPath), { recursive: true });

  if (typeof base64OrPath === "string" && base64OrPath.startsWith("data:image/")) {
    const data = base64OrPath.split(",")[1] || "";
    fs.writeFileSync(logoPath, Buffer.from(data, "base64"));
    return logoPath;
  }

  if (typeof base64OrPath === "string" && fs.existsSync(base64OrPath)) {
    const sourcePath = path.resolve(base64OrPath);
    const targetPath = path.resolve(logoPath);
    if (sourcePath !== targetPath) {
      fs.copyFileSync(sourcePath, targetPath);
    }
    return logoPath;
  }

  return base64OrPath;
}

module.exports = {
  getLogoAssetPath,
  persistLogo,
};
