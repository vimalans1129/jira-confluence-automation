import { createInterface } from "node:readline/promises";
import argon2 from "argon2";

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question("Password to hash: ");
rl.close();

if (password.length === 0) {
  console.error("The password must not be empty.");
  process.exit(1);
}
console.log(await argon2.hash(password));
