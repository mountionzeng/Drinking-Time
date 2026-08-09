import net from "node:net";
import path from "node:path";

const DEVELOPMENT_PORT = 3000;

export function assertDevelopmentPort(port: number): void {
  if (port !== DEVELOPMENT_PORT) {
    throw new Error(`Development server must use port ${DEVELOPMENT_PORT}.`);
  }
}

export function assertDevelopmentServerCwd(
  cwd: string,
  primaryWorktreePath: string
): void {
  if (path.resolve(cwd) !== path.resolve(primaryWorktreePath)) {
    throw new Error(
      `Development server must be started from the primary worktree (${primaryWorktreePath}), not ${cwd}.`
    );
  }
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

export async function findAvailablePort(startPort: number = 3000): Promise<number> {
  if (!(await isPortAvailable(startPort))) {
    throw new Error(
      `Port ${startPort} is already in use. Stop the process using it before starting the development server.`
    );
  }
  return startPort;
}
