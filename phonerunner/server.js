"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const PAGES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/device", "device.html"],
  ["/device/", "device.html"],
  ["/device.html", "device.html"],
  ["/app.css", "app.css"],
]);

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function getContainerStatus(callback) {
  execFile(
    "docker",
    ["inspect", "--format", "{{.State.Status}}", "android-vps"],
    { timeout: 3000, windowsHide: true },
    (error, stdout, stderr) => {
      if (error) {
        console.error("Unable to read Docker container status:", error.message);
        const message = stderr.trim() || error.message;
        callback(new Error(message));
        return;
      }
      callback(null, stdout.trim());
    },
  );
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  if (url.pathname === "/api/status") {
    getContainerStatus((error, state) => {
      if (error) {
        sendJson(response, 503, { state: "unavailable", error: "Status container tidak dapat dibaca." });
        return;
      }
      sendJson(response, 200, { state, container: "android-vps" });
    });
    return;
  }

  const fileName = PAGES.get(url.pathname);
  if (!fileName) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(path.join(__dirname, fileName), (error, contents) => {
    if (error) {
      console.error(`Unable to read ${fileName}:`, error.message);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Tidak dapat membaca halaman aplikasi.");
      return;
    }
    const isStyleSheet = fileName.endsWith(".css");
    response.writeHead(200, {
      "Content-Type": isStyleSheet ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Android Virtual UI listening on http://${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error("UI backend failed to start:", error.message);
  process.exitCode = 1;
});
