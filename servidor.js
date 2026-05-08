/**
 * CELUIDO — Servidor WebSocket
 * Relay de señales gestuales: celulares → maestro
 * 
 * Protocolo de mensajes:
 *   celular → server: { type: "control", id, ratio, modIndex, amp, beta, gamma }
 *   server → maestro: { type: "control", id, ratio, modIndex, amp, beta, gamma }
 *   server → maestro: { type: "connect", id, voiceCount }
 *   server → maestro: { type: "disconnect", id, voiceCount }
 *   server → todos:   { type: "ping" }
 */

const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// Servidor HTTP para servir archivos estáticos (celular.html, maestro.html)
const httpServer = http.createServer((req, res) => {
let filePath = "./public" + req.url;
if (filePath === "./public/") filePath = "./public/maestro.html";

  const extname = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
  };
  const contentType = contentTypes[extname] || "text/plain";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end(`Archivo no encontrado: ${req.url}`);
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    }
  });
});

// Servidor WebSocket sobre el mismo puerto HTTP
const wss = new WebSocket.Server({ server: httpServer });

// Registro de clientes
const controladores = new Map(); // id → ws (celulares)
let maestro = null;              // cliente maestro único
let voiceCounter = 0;

function broadcast(data) {
  const msg = JSON.stringify(data);
  if (maestro && maestro.readyState === WebSocket.OPEN) {
    maestro.send(msg);
  }
}

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  let clientId = null;
  let clientRole = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Registro de rol
    if (msg.type === "register") {
      clientRole = msg.role;

      if (clientRole === "maestro") {
        maestro = ws;
        // Notificar estado actual al maestro recién conectado
        ws.send(JSON.stringify({
          type: "state",
          voiceCount: controladores.size,
          voices: Array.from(controladores.keys()),
        }));
        console.log(`[+] Maestro conectado desde ${ip}`);

      } else if (clientRole === "controlador") {
        voiceCounter++;
        clientId = `voz-${voiceCounter}`;
        controladores.set(clientId, ws);
        ws.send(JSON.stringify({ type: "assigned", id: clientId }));
        broadcast({ type: "connect", id: clientId, voiceCount: controladores.size });
        console.log(`[+] Controlador ${clientId} conectado (${controladores.size} activos)`);
      }
      return;
    }

    // Relay de datos de control: controlador → maestro
    if (msg.type === "control" && clientRole === "controlador" && clientId) {
      broadcast({
        type: "control",
        id: clientId,
        ratio: msg.ratio,
        modIndex: msg.modIndex,
        amp: msg.amp,
        beta: msg.beta,
        gamma: msg.gamma,
      });
    }
  });

  ws.on("close", () => {
    if (clientRole === "maestro") {
      maestro = null;
      console.log("[-] Maestro desconectado");
    } else if (clientRole === "controlador" && clientId) {
      controladores.delete(clientId);
      broadcast({ type: "disconnect", id: clientId, voiceCount: controladores.size });
      console.log(`[-] Controlador ${clientId} desconectado (${controladores.size} activos)`);
    }
  });

  ws.on("error", (err) => {
    console.error(`[!] Error en ${clientId || "cliente"}: ${err.message}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`\nCELUIDO — Servidor activo`);
  console.log(`  http://localhost:${PORT}/maestro.html  → cliente maestro`);
  console.log(`  http://localhost:${PORT}/celular.html  → controladores`);
  console.log(`  ws://localhost:${PORT}               → WebSocket\n`);
});
