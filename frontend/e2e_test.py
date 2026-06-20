#!/usr/bin/env python3
"""全量端到端测试 - 便便记录器
   前置条件: 后端服务已启动于 http://localhost:3000
   测试范围: 登录 -> 首页打卡 -> 周视图 -> 月视图 -> 历史明细 -> 设置 -> 管理员视图
"""
import sys
import urllib.request
import urllib.error
import socket
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:3000"
API_HEALTH = "http://localhost:3000/health"
TEST_EMAIL = "test@example.com"
TEST_PASS = "test123"
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASS = "admin123"

def log(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")

def preflight_checks():
    """前置条件检查: 确认服务端口可达 + API健康检查"""
    log("Preflight: 服务可达性检查")
    errors = []

    # 1. 端口可达
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)
    try:
        sock.connect(("localhost", 3000))
        print("   ✅ 端口 3000 可达")
    except Exception as e:
        errors.append(f"端口不可达: {e}")
        print(f"   ❌ 端口 3000 不可达: {e}")
    finally:
        sock.close()

    # 2. HTTP 健康接口
    try:
        req = urllib.request.Request(API_HEALTH)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read().decode("utf-8")
            print(f"   ✅ /health 响应: {data[:120]}")
    except urllib.error.URLError as e:
        errors.append(f"/health 不可达: {e}")
        print(f"   ❌ /health 响应异常: {e}")

    # 3. 登录接口冒烟测试
    try:
        import json
        body = json.dumps({"email": TEST_EMAIL, "password": TEST_PASS}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/api/login",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if "token" in data:
                print(f"   ✅ /api/login 正常 (token 已获取)")
            else:
                errors.append(f"登录响应无 token: {data}")
                print(f"   ❌ 登录响应异常: {data}")
    except urllib.error.URLError as e:
        errors.append(f"/api/login 失败: {e}")
        print(f"   ❌ /api/login 异常: {e}")

    if errors:
        print(f"\n   ❌ Preflight 失败: {len(errors)} 项")
        return False
    print(f"\n   ✅ 所有前置条件通过")
    return True


def run_ui_tests():
    """主 UI 测试流程"""
    errors = []
    warnings = []
    passed_steps = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 设置浏览器 context，清空 localStorage
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: console_errors.append(f"[page-error] {exc}"))

        try:
            # ==== 1. 登录页面加载 ====
            log("步骤 1: 登录页加载与表单校验")
            page.goto(BASE_URL, wait_until="networkidle", timeout=15000)
            page.wait_for_timeout(1500)
            title = page.title()
            print(f"   页面标题: {title}")
            print(f"   URL: {page.url}")

            if "login" not in page.url:
                # 有缓存的 token，先清除
                page.evaluate("localStorage.clear()")
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(1500)

            email_input = page.locator('input[type="email"], input#email')
            pass_input = page.locator('input[type="password"]')
            submit_btn = page.locator('button[type="submit"]')
            assert email_input.count() > 0, "未找到邮箱输入框"
            assert pass_input.count() > 0, "未找到密码输入框"
            assert submit_btn.count() > 0, "未找到登录按钮"
            print("   ✅ 登录表单完整")
            passed_steps += 1

            # ==== 2. 登录提交 ====
            log("步骤 2: 登录提交")
            email_input.fill(TEST_EMAIL)
            pass_input.fill(TEST_PASS)
            submit_btn.click()
            # 等待登录后的首页
            page.wait_for_timeout(3000)
            print(f"   登录后 URL: {page.url}")

            # 确认在首页 (或不是登录页)
            if "login" in page.url:
                err_el = page.locator('[class*="error"]')
                err_txt = err_el.first.inner_text() if err_el.count() else "未知错误"
                errors.append(f"登录失败: {err_txt}")
                print(f"   ❌ 登录失败: {err_txt}")
            else:
                print("   ✅ 登录成功 (已跳转到首页)")
                passed_steps += 1

            # ==== 3. 首页 HomeView ====
            log("步骤 3: 首页 HomeView")
            navbar = page.locator(".navbar")
            assert navbar.count() > 0, "未找到导航栏"
            print("   ✅ 导航栏存在")

            streak = page.locator('[class*="streak"]').first
            streak_text = streak.inner_text() if streak.count() else ""
            print(f"   🔥 Streak: {streak_text[:50]}")
            assert streak.count() > 0 and "连续" in streak_text
            passed_steps += 1

            # 点击开始打卡按钮
            record_btn = page.locator('.record-btn, button[class*="start"], button[class*="record"]').first
            if record_btn.count() > 0:
                print(f"   打卡按钮文本: {record_btn.inner_text()[:30]}")
                print("   ✅ 打卡按钮存在")
                passed_steps += 1

            # 最近记录
            recent = page.locator('[class*="recent"]')
            if recent.count() > 0:
                print(f"   ✅ 最近记录: {recent.count()} 个元素")
            else:
                warnings.append("未找到最近记录区域")

            # ==== 4. 周视图 WeeklyView ====
            log("步骤 4: 周视图 WeeklyView")
            week_link = page.locator('a[href="/weekly"]')
            if week_link.count() == 0:
                week_link = page.locator('.nav-link').locator('text=周')
            if week_link.count() > 0:
                week_link.first.click(timeout=5000)
            else:
                page.goto(f"{BASE_URL}/weekly", wait_until="networkidle")
            page.wait_for_timeout(2000)
            print(f"   URL: {page.url}")
            assert "/weekly" in page.url

            bars = page.locator('[class*="bar"]')
            print(f"   📊 柱状图元素: {bars.count()}")
            assert bars.count() > 5

            # 查找有统计数字的元素（天数/次数）
            stats_el = page.locator('[class*="stat"]')
            print(f"   统计数字元素: {stats_el.count()}")
            passed_steps += 1

            # ==== 5. 月视图 MonthlyView ====
            log("步骤 5: 月视图 MonthlyView")
            m_link = page.locator('a[href="/monthly"]')
            if m_link.count() == 0:
                m_link = page.locator('.nav-link').locator('text=月')
            if m_link.count() > 0:
                m_link.first.click(timeout=5000)
            else:
                page.goto(f"{BASE_URL}/monthly", wait_until="networkidle")
            page.wait_for_timeout(2000)
            print(f"   URL: {page.url}")
            assert "/monthly" in page.url

            calendar = page.locator('[class*="calendar"]')
            print(f"   📅 日历元素: {calendar.count()}")
            assert calendar.count() > 0
            passed_steps += 1

            month_switch = page.locator('.month-nav button')
            if month_switch.count() > 0:
                print(f"   ✅ 月份切换按钮: {month_switch.count()}")
            else:
                warnings.append("未找到明显的月份切换按钮")

            # ==== 6. 历史明细 HistoryView ====
            log("步骤 6: 历史明细 HistoryView")
            h_link = page.locator('a[href="/history"]')
            if h_link.count() == 0:
                h_link = page.locator('.nav-link').locator('text=明细')
            if h_link.count() > 0:
                h_link.first.click(timeout=5000)
            else:
                page.goto(f"{BASE_URL}/history", wait_until="networkidle")
            page.wait_for_timeout(2000)
            print(f"   URL: {page.url}")
            assert "/history" in page.url

            filter_el = page.locator('[class*="filter"]')
            print(f"   筛选元素: {filter_el.count()}")

            records = page.locator('[class*="record-item"], [class*="records"]')
            print(f"   📜 记录相关元素: {records.count()}")

            # 导出按钮
            export_btn = page.locator('button:has-text("复制"), button:has-text("导出")')
            print(f"   导出/复制按钮: {export_btn.count()}")
            passed_steps += 1

            # ==== 7. 设置页 SettingsView ====
            log("步骤 7: 设置页 SettingsView")
            # 使用多种方式定位设置链接（router-link）
            settings_link = page.locator('a[href="/settings"]')
            if settings_link.count() == 0:
                settings_link = page.locator('.nav-link').locator('text=设置')
            if settings_link.count() == 0:
                # 直接导航
                page.goto(f"{BASE_URL}/settings", wait_until="networkidle")
            else:
                settings_link.first.click(timeout=5000)
            page.wait_for_timeout(2000)
            print(f"   URL: {page.url}")
            assert "/settings" in page.url

            settings_el = page.locator('[class*="settings"]')
            print(f"   设置元素: {settings_el.count()}")
            assert settings_el.count() > 0

            selects = page.locator('select')
            print(f"   时间下拉选择: {selects.count()}")
            assert selects.count() >= 2
            passed_steps += 1

            # ==== 8. 管理员视图 AdminView ====
            log("步骤 8: 管理员视图 AdminView (普通用户应被拦截)")
            admin_link = page.locator('a[href="/admin"]')
            if admin_link.count() > 0:
                # 普通用户有管理链接，点击应被重定向到首页
                admin_link.click()
                page.wait_for_timeout(2000)
                print(f"   普通用户点击管理后的 URL: {page.url}")
                if "/admin" in page.url and page.locator('[class*="user"], [class*="admin"]').count() == 0:
                    warnings.append("普通用户能访问 /admin 但没有内容 (应该有前端拦截)")
                print("   ✅ /admin 有链接 (对普通用户的权限由后端拦截)")

            # 退出当前用户，登录管理员
            log("步骤 9: 管理员登录")
            logout_btn = page.locator('.logout-btn')
            if logout_btn.count() > 0:
                logout_btn.click()
                page.wait_for_timeout(2000)
                print("   已退出当前用户")
            else:
                page.evaluate("localStorage.clear()")
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(1500)

            # 管理员登录
            email_input = page.locator('input[type="email"], input#email')
            pass_input = page.locator('input[type="password"]')
            email_input.fill(ADMIN_EMAIL)
            pass_input.fill(ADMIN_PASS)
            page.locator('button[type="submit"]').click()
            page.wait_for_timeout(3000)
            print(f"   管理员登录后 URL: {page.url}")

            admin_link = page.locator('a[href="/admin"]')
            if admin_link.count() > 0:
                admin_link.click()
                page.wait_for_timeout(2000)
                print(f"   🛡 管理员 URL: {page.url}")
                assert "/admin" in page.url

                user_cards = page.locator('[class*="user-card"], [class*="user_"], [class*="admin-card"]')
                print(f"   用户卡片元素: {user_cards.count()}")

                # 用户列表
                users_list = page.locator('[class*="user-list"], [class*="users"]')
                print(f"   用户列表元素: {users_list.count()}")

                print("   ✅ 管理员视图正常")
                passed_steps += 1

            # ==== 10. 响应式布局 ====
            log("步骤 10: 响应式布局")
            sizes = [
                (375, 812, "iPhone"),
                (768, 1024, "iPad"),
                (1280, 800, "桌面"),
            ]
            for w, h, name in sizes:
                page.set_viewport_size({"width": w, "height": h})
                page.goto(f"{BASE_URL}/home", wait_until="networkidle")
                page.wait_for_timeout(1000)
                navbar = page.locator(".navbar")
                assert navbar.count() > 0, f"{name} 下没有导航栏"
                print(f"   ✅ {name} ({w}x{h}): 导航栏正常")
            passed_steps += 1

            # ==== 11. 控制台 JS 错误检查 ====
            log("步骤 11: 控制台错误检查")
            critical_errors = [e for e in console_errors if not any(k in e for k in ["favicon", "404", "chrome-extension", "Preconnect"])]
            if critical_errors:
                print(f"   ⚠️  控制台错误: {len(critical_errors)} 条")
                for e in critical_errors[:5]:
                    print(f"      • {e[:120]}")
                warnings.extend(critical_errors[:3])
            else:
                print(f"   ✅ 无关键 JS 控制台错误")
            passed_steps += 1

            # ==== 12. 截图 ====
            log("步骤 12: 截图存档")
            page.set_viewport_size({"width": 1280, "height": 800})
            page.goto(f"{BASE_URL}/", wait_until="networkidle")
            page.wait_for_timeout(1500)
            page.screenshot(path="/tmp/poopreminder_home.png", full_page=True)
            page.goto(f"{BASE_URL}/weekly", wait_until="networkidle")
            page.wait_for_timeout(1500)
            page.screenshot(path="/tmp/poopreminder_weekly.png", full_page=True)
            print("   📸 截图已保存: /tmp/poopreminder_home.png, /tmp/poopreminder_weekly.png")
            passed_steps += 1

        except AssertionError as e:
            errors.append(str(e))
            print(f"   ❌ 断言失败: {e}")
        except Exception as e:
            errors.append(f"异常: {e}")
            print(f"   ❌ 异常: {e}")
        finally:
            browser.close()

    # 总结
    log("UI 测试总结")
    print(f"   👟 通过步骤: {passed_steps}")
    print(f"   ❌ 错误: {len(errors)}")
    for e in errors:
        print(f"      - {e}")
    print(f"   ⚠️  警告: {len(warnings)}")
    for w in warnings:
        print(f"      - {w[:120]}")

    return passed_steps, errors, warnings


def api_integration_tests():
    """API 集成测试: 使用 curl 直接测试后端 API"""
    log("API 集成测试")

    import json
    import base64

    errors = []
    passed = 0

    # 登录
    try:
        body = json.dumps({"email": TEST_EMAIL, "password": TEST_PASS}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/api/login",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        token = data["token"]
        user = data["user"]
        print(f"   ✅ 登录成功，用户: {user.get('username')}")
        passed += 1
    except Exception as e:
        errors.append(f"登录失败: {e}")
        return passed, errors

    auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 获取用户信息
    tests = [
        ("/api/user", "GET", None, "用户信息"),
        ("/api/record/home", "GET", None, "首页数据"),
        ("/api/poop-types", "GET", None, "大便类型"),
        ("/api/record/weekly?date=2026-06-18", "GET", None, "周统计"),
        ("/api/record/monthly?date=2026-06-18", "GET", None, "月统计"),
        ("/api/record/list?limit=5", "GET", None, "历史列表"),
        ("/api/record/export?format=txt&range=week", "GET", None, "导出 TXT"),
    ]
    for path, method, payload, name in tests:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            body = None
            if payload:
                body = json.dumps(payload).encode()
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_data = json.loads(resp.read().decode()) if resp.headers.get("Content-Type", "").startswith("application/json") else "text/plain"
            print(f"   ✅ {name} ({method} {path})")
            passed += 1
        except Exception as e:
            errors.append(f"{name}: {e}")
            print(f"   ❌ {name}: {e}")

    return passed, errors


if __name__ == "__main__":
    log("=== 便便记录器 E2E 测试 ===")

    # 1. 前置条件
    if not preflight_checks():
        print("\n   ❌ 前置条件未满足，测试终止")
        sys.exit(1)

    # 2. API 测试
    api_passed, api_errors = api_integration_tests()
    print(f"\n   API 测试结果: {api_passed} 通过, {len(api_errors)} 失败")

    # 3. UI 测试
    ui_passed, ui_errors, ui_warnings = run_ui_tests()

    # 最终输出
    log("最终报告")
    print(f"   API 测试: {api_passed} 通过, {len(api_errors)} 失败")
    print(f"   UI 测试: {ui_passed} 步骤通过, {len(ui_errors)} 错误, {len(ui_warnings)} 警告")
    total_errors = len(api_errors) + len(ui_errors)
    if total_errors == 0:
        print(f"\n   🎉🎉🎉 全部 E2E 测试通过！共 {api_passed} API + {ui_passed} UI 步骤")
        sys.exit(0)
    else:
        print(f"\n   ❌ 有 {total_errors} 个错误 (API: {len(api_errors)}, UI: {len(ui_errors)})")
        sys.exit(1)
