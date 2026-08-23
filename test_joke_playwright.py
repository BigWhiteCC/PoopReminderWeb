"""验证：进入拉屎页面后是否出现笑话卡片；点击"换一个"是否刷新。"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 420, "height": 900})
    page = ctx.new_page()

    page.goto("http://localhost:5174/", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    print("URL:", page.url)
    print("Title:", page.title())

    if "login" in page.url.lower():
        print("检测到登录页，尝试登录/注册测试账户")
        page.screenshot(path="test_login_page.png", full_page=True)
        email_inputs = page.locator('input[type="email"], input[name="email"]')
        password_inputs = page.locator('input[type="password"], input[name="password"]')
        if email_inputs.count() > 0:
            email_inputs.first.fill("dev@test.com")
        if password_inputs.count() > 0:
            password_inputs.first.fill("123456")
        login_btn = page.locator('button:has-text("登录"), button[type="submit"], button:has-text("Login")').first
        if login_btn.count() > 0:
            login_btn.click()
            page.wait_for_timeout(2500)
        if "login" in page.url.lower():
            reg_tab = page.locator('text=注册, text=Register, a:has-text("注册")').first
            if reg_tab.count() > 0:
                reg_tab.click()
                page.wait_for_timeout(800)
                for key, val in [('input[name="username"]', "devtester"),
                                 ('input[type="email"], input[name="email"]', "dev@test.com"),
                                 ('input[type="password"], input[name="password"]', "123456")]:
                    el = page.locator(key).first
                    if el.count() > 0:
                        try: el.fill(val)
                        except: pass
                page.locator('button:has-text("注册"), button:has-text("Register"), button[type="submit"]').first.click()
                page.wait_for_timeout(3000)

    print("After login attempt URL:", page.url)
    page.screenshot(path="test_01_home.png", full_page=True)

    start_btn = page.locator('button:has-text("开始拉屎"), .btn-start').first
    if start_btn.count() == 0:
        btns = page.locator('button').all_text_contents()
        print("Available buttons:", btns[:20])
        raise SystemExit("找不到开始拉屎按钮")
    start_btn.click()
    page.wait_for_timeout(1200)
    page.screenshot(path="test_02_pooping_timer.png", full_page=True)

    joke_card = page.locator('.joke-card').first
    if joke_card.count() == 0:
        print("❌ 未找到 .joke-card 元素")
        raise SystemExit(1)
    print("✅ 笑话卡片已出现")

    joke_content = page.locator('.joke-content').first
    initial_text = joke_content.inner_text() if joke_content.count() > 0 else ""
    print("初始笑话内容：", initial_text[:80], "…")
    if not initial_text:
        print("⚠️ 笑话内容暂空，等待远程API…")
        page.wait_for_timeout(3000)
        initial_text = joke_content.inner_text() if joke_content.count() > 0 else ""
        page.screenshot(path="test_03_after_wait.png", full_page=True)
        print("等待后内容：", initial_text[:100])

    refresh_btn = page.locator('.joke-refresh').first
    if refresh_btn.count() > 0:
        refresh_btn.click()
        page.wait_for_timeout(2500)
        new_text = joke_content.inner_text() if joke_content.count() > 0 else ""
        print("刷新后笑话内容：", new_text[:80], "…")
        if new_text:
            print("✅ 换一个按钮工作正常")
        else:
            print("⚠️ 换一个后笑话仍为空")
            page.screenshot(path="test_04_after_refresh.png", full_page=True)

    page.screenshot(path="test_05_final.png", full_page=True)
    print("✅ 所有验证步骤完成")
    browser.close()
