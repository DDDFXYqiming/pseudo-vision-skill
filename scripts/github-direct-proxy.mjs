// github-direct-proxy.mjs — minimal HTTP CONNECT proxy that tunnels to a
// fixed GitHub IP. Workaround for DNS pollution: git keeps URL host
// github.com (correct SNI) while the connection lands on a reachable IP.
//
// Usage: node github-direct-proxy.mjs <listenPort> <targetIP> [targetPort]
// Then:  git config --global http.https://github.com/.proxy http://127.0.0.1:<port>
import net from "node:net";

const [, , portStr = "8123", target = "140.82.112.3", targetPort = "443"] = process.argv;
const listenPort = Number(portStr);

const server = net.createServer((client) => {
    let pending = Buffer.alloc(0);
    let upstream = null;

    const onUpstreamReady = () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream);
        upstream.pipe(client);
        client.off("data", onClientData);
        pending = null;
    };

    const onClientData = (chunk) => {
        pending = Buffer.concat([pending ?? Buffer.alloc(0), chunk]);
        const headerEnd = pending.indexOf("\r\n\r\n");
        if (headerEnd === -1) return; // keep buffering
        // CONNECT github.com:443 HTTP/1.1 ... — target host is irrelevant,
        // we always tunnel to the fixed IP.
        upstream = net.connect(Number(targetPort), target, onUpstreamReady);
        upstream.on("error", () => client.destroy());
        // Any bytes after the header belong to the tunneled TLS stream.
        const rest = pending.subarray(headerEnd + 4);
        pending = null;
        if (rest.length > 0) {
            client.off("data", onClientData);
            upstream.write(rest);
        }
    };

    client.on("data", onClientData);
    client.on("error", () => { /* ignore */ });
    client.on("close", () => upstream?.destroy());
    upstream?.on("close", () => client.destroy());
});

server.listen(listenPort, "127.0.0.1", () => {
    console.log(`github-direct-proxy: listening 127.0.0.1:${listenPort} → ${target}:${targetPort}`);
});
