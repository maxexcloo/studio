import { listenOnPort } from "./launch.js";

/**
 * Starts plain HTTP on `port`; TLS terminates in front of Studio. `onListening`
 * runs once it is up with the port it got (launch.js). A failure to bind is
 * fatal (`onFatal`).
 */
export async function startServers(app, { host, port, onListening, onFatal }) {
  let listening;
  try {
    listening = await listenOnPort(app, { port, host });
  } catch (error) {
    onFatal(error);
    return null;
  }
  onListening({ port: listening.port });
  return { server: listening.server, servers: [listening.server] };
}
