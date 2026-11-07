/** 发布构建只写入新建的 dist 子目录；源码清单、素材和合集均只读。 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import yauzl from "yauzl";
import yazl from "yazl";
import { verifyBootstrap } from "./release-bootstrap.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RUNTIME_DIRECTORIES = ["assets", "data", "lang", "templates"];

/** 将包内路径解析到指定根目录；拒绝绝对路径、目录穿越和 Windows 分隔符。 */
export function packagePath(root, relative) {
  if (!relative || relative.includes("\\") || relative.split("/").some(part => part === "..")
    || path.posix.isAbsolute(relative) || relative.includes(":")) {
    throw new Error(`非法包内路径：${relative}`);
  }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`路径越界：${relative}`);
  return absolute;
}

/** 枚举可分发文件；不跟随链接，保留 LevelDB 的数字编号 .log（WAL）。 */
export async function listFiles(root, relative = "") {
  const directory = await lstat(path.join(root, relative));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`发布资源必须是普通目录：${relative}`);
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`发布目录不接受符号链接：${name}`);
    if (entry.isDirectory()) result.push(...await listFiles(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`不支持的文件类型：${name}`);
  }
  return result.sort();
}

/** 文件指纹用于核对复制和 ZIP 内容，避免产出缺失或复制期间变化的合集。 */
export async function fingerprint(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

/** 按清单建立文件白名单；合集必须已有完整 CURRENT/MANIFEST，不重建数据库。 */
export async function runtimeFiles(root, manifest) {
  const files = [manifest.license, manifest.readme];
  for (const directory of RUNTIME_DIRECTORIES) files.push(...await listFiles(root, directory));
  for (const pack of manifest.packs ?? []) {
    if (!pack.path.startsWith("packs/")) throw new Error(`合集路径必须位于 packs/：${pack.path}`);
    const directory = packagePath(root, pack.path);
    const current = (await readFile(path.join(directory, "CURRENT"), "utf8")).trim();
    if (!/^MANIFEST-\d+$/.test(current)) throw new Error(`合集 CURRENT 无效：${pack.path}`);
    await lstat(path.join(directory, current));
    const packFiles = await listFiles(root, pack.path);
    files.push(...packFiles.filter(file => !/^(LOCK|LOG(?:\..*)?)$/.test(path.posix.basename(file))));
  }
  const unique = [...new Set(files)].sort();
  for (const file of unique) {
    const info = await lstat(packagePath(root, file));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`发布资源必须是普通文件：${file}`);
  }
  return unique;
}

/** CSS 顺序来自开发清单；只重定位 url()，素材继续使用原来的包内位置。 */
export async function compileStyles(root, styles, outfile) {
  for (const file of styles) packagePath(root, file);
  const references = new Set();
  const entry = styles.map(file => `@import ${JSON.stringify(`./${file}`)};`).join("\n");
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: entry, resolveDir: root, sourcefile: "release-styles.css", loader: "css" },
    outfile, bundle: true, write: false, metafile: true,
    minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false,
    sourcemap: "linked", charset: "utf8", logLevel: "silent",
    plugins: [{
      name: "package-css-assets",
      setup(context) {
        context.onResolve({ filter: /.*/ }, async args => {
          if (args.kind !== "url-token") return;
          if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(args.path)) return { path: args.path, external: true };
          const [, pathname, suffix] = args.path.match(/^([^?#]*)(.*)$/);
          const absolute = path.resolve(args.resolveDir, decodeURIComponent(pathname));
          const relative = path.relative(root, absolute).split(path.sep).join("/");
          const asset = packagePath(root, relative);
          if (!relative.startsWith("assets/") || !(await lstat(asset)).isFile()) {
            throw new Error(`CSS 素材不在发布白名单内：${args.path}`);
          }
          references.add(relative);
          return { path: `../${relative}${suffix}`, external: true };
        });
      }
    }]
  });
  if (result.warnings.length) throw new Error(result.warnings.map(warning => warning.text).join("\n"));
  return { ...result, references: [...references] };
}

/** 合并真实 ESM 依赖图；保留名称、属性和副作用，只压缩空白以减少语义变化。 */
export async function compileJavaScript(root, entry, outfile) {
  const result = await build({
    absWorkingDir: root, entryPoints: [packagePath(root, entry)], outfile,
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    write: false, metafile: true, keepNames: true, treeShaking: false, ignoreAnnotations: true,
    minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false,
    sourcemap: "linked", charset: "utf8", legalComments: "eof", logLevel: "silent"
  });
  if (result.warnings.length) throw new Error(result.warnings.map(warning => warning.text).join("\n"));
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.length) throw new Error("JS 构建仍存在外部模块依赖，请先声明其发布方式。");
  }
  return result;
}

/** 写入构建结果；wx 防止意外覆盖任何已有文件。 */
async function writeOutputs(result) {
  for (const file of result.outputFiles) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, { flag: "wx" });
  }
}

/** 校验入口、模板及 CSS 素材在发布目录中存在，避免开发目录掩盖漏打包问题。 */
export async function verifyRuntimePaths(directory, manifest, cssReferences) {
  const files = [
    ...manifest.esmodules, ...manifest.styles, manifest.license, manifest.readme,
    ...manifest.languages.map(language => language.path), ...cssReferences,
    manifest.background.replace(`systems/${manifest.id}/`, "")
  ];
  const javascript = await readFile(packagePath(directory, manifest.esmodules[0]), "utf8");
  // 构建后的注释已移除；只检查完整静态模板字符串，插值路径由功能回归覆盖。
  const templates = javascript.matchAll(/"systems\/xjzl-system\/([^"\r\n]+\.hbs)"/g);
  files.push(...[...templates].map(match => match[1]));
  for (const file of new Set(files)) {
    if (!(await lstat(packagePath(directory, file))).isFile()) throw new Error(`发布资源缺失：${file}`);
  }
}

/** 用流式 ZIP 避免大素材占满内存；归档根目录直接放 system.json，供 Foundry 安装。 */
export async function createArchive(directory, filename, files) {
  const archive = new yazl.ZipFile();
  archive.on("error", error => archive.outputStream.destroy(error));
  const completion = pipeline(archive.outputStream, createWriteStream(filename, { flags: "wx" }));
  for (const file of files) {
    archive.addFile(packagePath(directory, file), file, {
      mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644
    });
  }
  archive.end();
  await completion;
}

/** 逐项解压并比对 SHA-256；拒绝重复、遗漏或混入白名单之外的 ZIP 条目。 */
export async function verifyArchive(filename, expected) {
  await new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true }, (error, archive) => {
      if (error) return reject(error);
      const seen = new Set();
      archive.on("error", reject);
      archive.on("end", () => {
        if (seen.size !== expected.size) reject(new Error("ZIP 文件数量与发布目录不一致。"));
        else resolve();
      });
      archive.on("entry", entry => {
        const check = async () => {
          if (!expected.has(entry.fileName) || seen.has(entry.fileName)) {
            throw new Error(`ZIP 包含非预期或重复条目：${entry.fileName}`);
          }
          const stream = await new Promise((accept, fail) => archive.openReadStream(entry, (err, value) => err ? fail(err) : accept(value)));
          const hash = createHash("sha256");
          for await (const chunk of stream) hash.update(chunk);
          if (hash.digest("hex") !== expected.get(entry.fileName)) throw new Error(`ZIP 校验失败：${entry.fileName}`);
          seen.add(entry.fileName);
          archive.readEntry();
        };
        check().catch(err => { archive.close(); reject(err); });
      });
      archive.readEntry();
    });
  });
}

/** 创建独立发布目录及经过校验的 ZIP；任一步失败均不报告可发布，旧产物保持原样。 */
export async function buildRelease(root = ROOT) {
  const manifest = JSON.parse(await readFile(path.join(root, "system.json"), "utf8"));
  if (!/^[a-z0-9-]+$/.test(manifest.id) || !/^[\w.-]+$/.test(manifest.version)) throw new Error("系统 ID 或版本号不适合作为发布路径。");
  if (manifest.esmodules?.length !== 1 || manifest.scripts?.length) throw new Error("发布构建要求单个 ESM 入口且没有经典 scripts，请先调整构建配置。");
  const files = await runtimeFiles(root, manifest);
  const before = new Map();
  for (const file of files) before.set(file, await fingerprint(packagePath(root, file)));
  await mkdir(path.join(root, "dist"), { recursive: true });
  const destination = await mkdtemp(path.join(root, "dist", `${manifest.id}-${manifest.version}-`));
  const directory = path.join(destination, manifest.id);
  await mkdir(directory);
  for (const file of files) {
    const target = packagePath(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(packagePath(root, file), target);
    if (await fingerprint(target) !== before.get(file)) throw new Error(`复制期间资源发生变化：${file}；请关闭 Foundry 后重试。`);
  }
  const javascript = await compileJavaScript(root, manifest.esmodules[0], path.join(directory, "xjzl-system.mjs"));
  const css = await compileStyles(root, manifest.styles, path.join(directory, "styles", "xjzl-system.css"));
  await writeOutputs(javascript);
  await writeOutputs(css);
  const releaseManifest = { ...manifest, esmodules: ["xjzl-system.mjs"], styles: ["styles/xjzl-system.css"] };
  await writeFile(path.join(directory, "system.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`, { flag: "wx" });
  await verifyRuntimePaths(directory, releaseManifest, css.references);
  await verifyBootstrap(root, directory);
  // 逐文件指纹和文件集合都须稳定，尤其不能遗漏复制期间新增的 LevelDB WAL。
  if (JSON.stringify(files) !== JSON.stringify(await runtimeFiles(root, manifest))) throw new Error("构建期间运行文件集合变化，请关闭 Foundry 后重试。");
  for (const file of files) {
    if (await fingerprint(packagePath(root, file)) !== before.get(file)) throw new Error(`构建期间资源发生变化：${file}；请关闭 Foundry 后重试。`);
  }
  const hashes = new Map();
  for (const file of await listFiles(directory)) hashes.set(file, await fingerprint(packagePath(directory, file)));
  const archive = path.join(destination, `${manifest.id}.zip`);
  const partialArchive = `${archive}.partial`;
  await createArchive(directory, partialArchive, [...hashes.keys()]);
  await verifyArchive(partialArchive, hashes);
  await rename(partialArchive, archive);
  await copyFile(path.join(directory, "system.json"), path.join(destination, "system.json"));
  const report = { id: manifest.id, version: manifest.version, files: hashes.size,
    javascriptModules: Object.keys(javascript.metafile.inputs).length, stylesheets: manifest.styles.length,
    sha256: Object.fromEntries(hashes) };
  await writeFile(path.join(destination, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return { destination, directory, archive, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await buildRelease();
    console.log(`XJZL | 发布构建通过：${result.report.javascriptModules} 个 JS 模块、${result.report.stylesheets} 份 CSS、${result.report.files} 个文件。`);
    console.log(`XJZL | ZIP：${result.archive}`);
    console.log(`XJZL | 发布清单：${path.join(result.destination, "system.json")}`);
  } catch (error) {
    console.error("XJZL | 发布构建失败；未完成的 dist 子目录不可发布。", error);
    process.exitCode = 1;
  }
}
