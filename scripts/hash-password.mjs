import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { hashPassword } from "../api/_lib/auth.js";

const readline = createInterface({ input, output });
try {
  const password = await readline.question("Password (12-256 characters): ");
  const confirmation = await readline.question("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match");
  console.log(await hashPassword(password));
} finally {
  readline.close();
}
