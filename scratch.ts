import * as lancedb from "@lancedb/lancedb"

async function test(uri: string, apiKey: string) {
  try {
    const conn = await lancedb.connect(uri, { apiKey })
    console.log(`[${uri}] Connected`)
    const tables = await conn.tableNames()
    console.log(`[${uri}] Tables:`, tables)
  } catch (err: any) {
    console.log(`[${uri}] Error:`, err.message)
  }
}
async function run() {
  await test("db://dummy", "dummy")
  await test("http://dummy", "dummy")
  await test("dummy", "dummy")
}
run()
