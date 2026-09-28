import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mjsPath = path.resolve(__dirname, "../node_modules/better-auth/dist/client/plugins/index.mjs");
const dtsPath = path.resolve(__dirname, "../node_modules/better-auth/dist/client/plugins/index.d.mts");

if (fs.existsSync(mjsPath)) {
  let content = fs.readFileSync(mjsPath, "utf-8");
  if (!content.includes("apiKeyClient")) {
    content = content.replace(
      'import { InferServerPlugin } from "./infer-plugin.mjs";',
      `import { InferServerPlugin } from "./infer-plugin.mjs";\nconst apiKeyClient = (options) => ({ id: "api-key", name: "API Key", ...options });\nconst genericOAuthClient = (options) => ({ id: "generic-oauth", name: "Generic OAuth", ...options });`
    );
    content = content.replace(
      "export {",
      "export { apiKeyClient, genericOAuthClient,"
    );
    fs.writeFileSync(mjsPath, content, "utf-8");
    console.log("Patched better-auth/dist/client/plugins/index.mjs with apiKeyClient and genericOAuthClient stubs.");
  }
}

if (fs.existsSync(dtsPath)) {
  let content = fs.readFileSync(dtsPath, "utf-8");
  if (!content.includes("apiKeyClient")) {
    content += `\nexport declare const apiKeyClient: (options?: any) => { id: string; name: string };\nexport declare const genericOAuthClient: (options?: any) => { id: string; name: string };\n`;
    fs.writeFileSync(dtsPath, content, "utf-8");
    console.log("Patched better-auth/dist/client/plugins/index.d.mts with apiKeyClient and genericOAuthClient stubs.");
  }
}
