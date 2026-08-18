/** 设计提醒：数字打字机日记——页头应像工作台标签，轻量、直接、始终让阅读保持中心。 */
import { Menu, Moon, Search, Sun, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { socialLinks } from "@/lib/blog";

const logo = "/manus-storage/fieldnote-logo_36885e21.png";

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [location] = useLocation();
  const active = href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link href={href} className={`nav-link ${active ? "is-active" : ""}`}>
      {children}
    </Link>
  );
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="site-rail header-rail">
        <Link href="/" className="brand-mark" aria-label="Fieldnote 首页" onClick={closeMenu}>
          <img src={logo} alt="Fieldnote 图形标记" />
          <span>fieldnote</span><b>·</b>
        </Link>
        <nav className="desktop-nav" aria-label="主要导航">
          <NavLink href="/posts">文章</NavLink>
          <NavLink href="/about">关于</NavLink>
          <NavLink href="/search">搜索</NavLink>
          <button className="theme-button" onClick={() => setIsDark((value) => !value)} aria-label="切换深浅色模式">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </nav>
        <div className="mobile-actions">
          <button className="theme-button" onClick={() => setIsDark((value) => !value)} aria-label="切换深浅色模式">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="打开菜单" aria-expanded={menuOpen}>
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="mobile-nav" aria-label="移动端导航">
          <NavLink href="/posts">文章</NavLink>
          <NavLink href="/about">关于</NavLink>
          <Link href="/search" onClick={closeMenu} className="nav-link"><Search size={15} /> 搜索</Link>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-rail footer-rail">
        <div className="footer-socials" aria-label="社交链接">
          {socialLinks.map((item) => (
            <a key={item.label} href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {item.label}
            </a>
          ))}
        </div>
        <p>把问题写小，答案才会出现。<span>CC BY 4.0 · 2026</span></p>
      </div>
    </footer>
  );
}

export function PageLayout({ children }: { children: ReactNode }) {
  return <div className="site-shell"><SiteHeader /><main className="site-rail">{children}</main><SiteFooter /></div>;
}
