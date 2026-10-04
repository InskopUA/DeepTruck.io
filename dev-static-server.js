const http = require("http");
const fs = require("fs");
const path = require("path");

const publicRoot = path.join(__dirname, "public");
const fallbackRoot = path.join(__dirname, "dist");
const root = fs.existsSync(publicRoot) ? publicRoot : fallbackRoot;
const port = Number(process.env.PORT || 5173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === "/admin") {
    res.writeHead(308, { Location: "/admin/" });
    res.end();
    return;
  }
  let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname === "/admin/") pathname = "/admin/index.html";
  if (pathname === "/verify") pathname = "/verify.html";
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Dev static server running at http://localhost:${port}`);
});
