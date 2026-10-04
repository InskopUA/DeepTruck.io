const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function replaceInFile(file, replacements) {
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  fs.writeFileSync(file, text);
}

resetDir(publicDir);
copyDir(path.join(root, "verify-site"), publicDir);
copyDir(path.join(root, "admin-site"), path.join(publicDir, "admin"));

replaceInFile(path.join(publicDir, "index.html"), [
  ["http://localhost:5174/index.html#signup", "/signup"],
  ["http://localhost:5174/index.html", "/login"]
]);

console.log("Built Vercel static output in public/");
