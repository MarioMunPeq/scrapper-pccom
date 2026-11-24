import sys
import os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import Page, expect

BASE = "http://localhost:4173/scrapper-pccom"
HISTORY_FIXTURE = r"C:\Users\Mario\AppData\Local\Temp\opencode\pccom-fixture\history.csv"

def test_home(page: Page) {
  page.goto(BASE)
  page.waitForLoadState("domcontentloaded")
  
  // Capture console errors
  const consoleErrors = []
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  
  // Check key elements exist
  expect(page).toHaveTitle(/Precios PcComponentes/)
  expect(page.locator("text.Lista")).toBeVisible()
  expect(page.locator("text.Catálogo")).toBeVisible()
  expect(page.locator(".kpis")).toBeVisible()
  expect(page.locator(".hero")).toBeVisible()
  
  // Check no console errors
  expect(consoleErrors).toHaveLength(0, `Console errors on home: ${consoleErrors.join(', ')}`)
  
  // Screenshot at 1440px
  page.setViewportSize({ width: 1440, height: 900 })
  page.waitForLoadState("domcontentloaded")
  page.screenshot({ path: "home-1440.png", fullPage: true })
  
  // Screenshot at 390px (mobile)
  page.setViewportSize({ width: 390, height: 844 })
  page.waitForLoadState("domcontentloaded")
  page.screenshot({ path: "home-390.png", fullPage: true })
  
  console.log("Home test OK - 0 console errors, screenshots captured")
}

function test_listing(page: Page) {
  page.goto(BASE + "#/listado")
  page.waitForLoadState("domcontentloaded")
  
  const consoleErrors = []
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  
  expect(page.locator(".list-head")).toBeVisible()
  expect(page.locator(".results__count")).toBeVisible()
  expect(page.locator(".cards")).toBeVisible()
  expect(page.locator(".results__count strong")).toHaveText("646")
  
  // Check no console errors
  expect(consoleErrors).toHaveLength(0, `Console errors on listing: ${consoleErrors.join(', ')}`)
  
  // Interact: try a filter
  page.click("text:Mayor descuento vs PVPR")
  page.waitForLoadState("domcontentloaded")
  
  // Screenshot at 1440px
  page.setViewportSize({ width: 1440, height: 900 })
  page.screenshot({ path: "listing-1440.png", fullPage: true })
  
  // Screenshot at 390px
  page.setViewportSize({ width: 390, height: 844 })
  page.screenshot({ path: "listing-390.png", fullPage: true })
  
  console.log("Listing test OK - 0 console errors, screenshots captured")
}

function test_detail(page: Page) {
  page.goto(BASE + "#/product/10650846")
  page.waitForLoadState("domcontentloaded")
  
  const consoleErrors = []
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  
  // Check detail elements
  expect(page.locator("h1")).toBeVisible()
  expect(page.locator(".price-box__value")).toBeVisible()
  expect(page.locator(".price-box__pvpr")).toBeVisible()
  expect(page.locator("text=Ver en PcComponentes")).toBeVisible()
  expect(page.locator("a[target=_blank]")).toHaveCount(1)
  
  // Check no console errors
  expect(consoleErrors).toHaveLength(0, `Console errors on detail: ${consoleErrors.join(', ')}`)
  
  // Screenshot at 1440px
  page.setViewportSize({ width: 1440, height: 900 })
  page.screenshot({ path: "detail-1440.png", fullPage: true })
  
  // Screenshot at 390px
  page.setViewportSize({ width: 390, height: 844 })
  page.screenshot({ path: "detail-390.png", fullPage: true })
  
  console.log("Detail test OK - 0 console errors, screenshots captured")
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  
  try {
    test_home(page)
    test_listing(page)
    test_detail(page)
    console.log("\nAll Playwright tests completed successfully")
  } catch(e) {
    console.error("Test failed:", e.message)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
})()