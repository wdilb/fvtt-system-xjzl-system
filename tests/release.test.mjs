/** 发布专项回归：真实模块启动对比、完整 CSS 顺序与资源重定位、白名单和 ZIP 内容。 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import {
  compileJavaScript, compileStyles, createArchive, fingerprint,
  listFiles, packagePath, runtimeFiles, verifyArchive, verifyRuntimePaths
} from "../scripts/build-release.mjs";
import { verifyBootstrap } from "../scripts/release-bootstrap.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "system.json"), "utf8"));

/** 测试资源写入独立临时目录，不改动开发系统或实际合集。 */
async function fixture(files) {
  const directory = await mkdtemp(path.join(tmpdir(), "xjzl-release-test-"));
  for (const [file, contents] of Object.entries(files)) {
    const filename = path.join(directory, file);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents);
  }
  return directory;
}

/** 将外部 CSS URL 规范化到统一网站位置，独立比较合并前后的完整规则顺序。 */
function absoluteCssUrls(css, file) {
  const base = `https://release.invalid/systems/xjzl-system/${file}`;
  // CSS 的带引号 URL 可包含括号；不能用简单的 [^)]* 截断 SVG data URI。
  return css.replace(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi,
    (match, double, single, bare) => {
      const value = (double ?? single ?? bare).trim();
      if (/^(?:data:|#)/i.test(value)) return match;
      return `url(${JSON.stringify(new URL(value, base).href)})`;
    });
}

test("包内路径不能逃逸或指向 Windows 绝对路径/数据流", () => {
  for (const file of ["../outside", "assets/../../outside", "/absolute", "C:/absolute", "assets\\file", "assets/file:stream"]) {
    assert.throws(() => packagePath(root, file), /非法|越界/);
  }
  assert.equal(packagePath(root, "assets/正常.png"), path.join(root, "assets", "正常.png"));
});

test("白名单包含运行数据和全部 WAL，排除开发文件与数据库诊断日志", async () => {
  const directory = await fixture({
    "assets/正常.png": "image", "data/sect-assets.json": "{}", "lang/zh-cn.json": "{}",
    "templates/a.hbs": "template", "LICENSE": "license", "README.md": "readme",
    "packs/items/CURRENT": "MANIFEST-000001\n", "packs/items/MANIFEST-000001": "manifest",
    "packs/items/000002.log": "wal", "packs/items/000003.ldb": "db",
    "packs/items/LOCK": "", "packs/items/LOG": "debug", "packs/items/LOG.old": "debug",
    ".git/config": "private", ".claude/CLAUDE.md": "private", "AGENTS.md": "private",
    "PROJECT_MAP.md": "private", "docs/a.md": "docs", "tests/a.test.mjs": "tests",
    ".gitignore": "ignore", "node_modules/private.js": "private", "package.json": "{}"
  });
  const selected = await runtimeFiles(directory, { license: "LICENSE", readme: "README.md", packs: [{ path: "packs/items" }] });
  assert.deepEqual(selected, [
    "LICENSE", "README.md", "assets/正常.png", "data/sect-assets.json", "lang/zh-cn.json",
    "packs/items/000002.log", "packs/items/000003.ldb", "packs/items/CURRENT",
    "packs/items/MANIFEST-000001", "templates/a.hbs"
  ]);
  await writeFile(path.join(directory, "packs/items/CURRENT"), "../outside");
  await assert.rejects(runtimeFiles(directory, { license: "LICENSE", readme: "README.md", packs: [{ path: "packs/items" }] }), /CURRENT/);
});

test("CSS 保持清单覆盖顺序，跨层级素材和 query/hash 正确重定位", async () => {
  const directory = await fixture({
    "styles/base/a.css": '.same { color: red; background: url("../../assets/image.svg?v=1#shape"); }',
    "styles/deep/nested/b.css": '.same { color: blue; mask: url("../../../assets/image.svg"); }',
    "assets/image.svg": "<svg/>",
    "styles/missing.css": 'a { background: url("../assets/missing.svg"); }'
  });
  const result = await compileStyles(directory, ["styles/base/a.css", "styles/deep/nested/b.css"], path.join(directory, "out/styles/xjzl-system.css"));
  const css = result.outputFiles.find(file => file.path.endsWith(".css")).text;
  assert.ok(css.indexOf("color:red") < css.indexOf("color:blue"));
  assert.match(css, /\.\.\/assets\/image\.svg\?v=1#shape/);
  assert.deepEqual(result.references, ["assets/image.svg"]);
  await assert.rejects(compileStyles(directory, ["styles/no.css"], path.join(directory, "out/styles/xjzl-system.css")));
  await assert.rejects(compileStyles(directory, ["styles/missing.css"], path.join(directory, "out/styles/xjzl-system.css")));
});

test("41 份真实 CSS 合并前后完整规则一致，不丢失或重排选择器/声明", async () => {
  const directory = await fixture({});
  const sources = [];
  for (const file of manifest.styles) sources.push(absoluteCssUrls(await readFile(path.join(root, file), "utf8"), file));
  const result = await compileStyles(root, manifest.styles, path.join(directory, "styles/xjzl-system.css"));
  const actual = result.outputFiles.find(file => file.path.endsWith(".css")).text;
  const options = { loader: "css", minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false };
  const expected = await transform(sources.join("\n"), options);
  const normalized = await transform(absoluteCssUrls(actual, "styles/xjzl-system.css"), options);
  assert.equal(normalized.code, expected.code);
});

test("真实 JS bundle 在 GM/玩家端保留启动注册、类名、Socket live binding 和动态脚本", async () => {
  const directory = await fixture({});
  const result = await compileJavaScript(root, manifest.esmodules[0], path.join(directory, "xjzl-system.mjs"));
  for (const output of result.outputFiles) await writeFile(output.path, output.contents);
  assert.ok(Object.keys(result.metafile.inputs).length >= 100);
  await verifyBootstrap(root, directory);
});

test("发布目录缺少静态模板时拒绝，不能依赖开发目录中的文件", async () => {
  const directory = await fixture({
    "xjzl-system.mjs": 'const template = "systems/xjzl-system/templates/missing.hbs";',
    "styles/main.css": "", "LICENSE": "license", "README.md": "readme", "assets/background.png": "image"
  });
  await assert.rejects(verifyRuntimePaths(directory, {
    id: "xjzl-system", esmodules: ["xjzl-system.mjs"], styles: ["styles/main.css"],
    license: "LICENSE", readme: "README.md", languages: [],
    background: "systems/xjzl-system/assets/background.png"
  }, []), /missing\.hbs/);
});

test("ZIP 根目录、中文文件名与二进制内容完整；篡改指纹或损坏 ZIP 均拒绝", async () => {
  const directory = await fixture({ "system.json": '{"id":"xjzl-system"}', "assets/中文.png": Buffer.from([0, 255, 17, 0]) });
  const files = await listFiles(directory);
  const expected = new Map();
  for (const file of files) expected.set(file, await fingerprint(path.join(directory, file)));
  const archive = path.join(directory, "test.zip");
  await createArchive(directory, archive, files);
  await verifyArchive(archive, expected);
  await assert.rejects(verifyArchive(archive, new Map([...expected, ["system.json", "bad-hash"]])), /校验失败/);
  const broken = path.join(directory, "broken.zip");
  await writeFile(broken, (await readFile(archive)).subarray(0, 64));
  await assert.rejects(verifyArchive(broken, expected));
});
