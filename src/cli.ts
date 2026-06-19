import { createInterface } from "readline";
import { initSchema } from "./db/client.js";
import { createUser } from "./auth/jwt.js";

async function prompt(question: string, hide = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hide) process.stdout.write(question);
    rl.question(hide ? "" : question, (answer) => {
      rl.close();
      if (hide) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function cmdCreateUser() {
  await initSchema();
  console.log("=== Create dashboard user ===");
  const email = await prompt("Email: ");
  const name  = await prompt("Name: ");
  const role  = (await prompt("Role (admin/manager/viewer) [admin]: ") || "admin") as "admin" | "manager" | "viewer";
  const password = await prompt("Password: ", true);
  const user = await createUser(email, password, name, role);
  console.log(`\nCreated: ${user.email} (${user.role})`);
  process.exit(0);
}

const cmd = process.argv[2];
if (cmd === "create-user") {
  cmdCreateUser().catch((err) => { console.error(err.message); process.exit(1); });
} else {
  console.error("Usage: node dist/cli.js create-user");
  process.exit(1);
}
