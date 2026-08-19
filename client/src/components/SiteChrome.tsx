import { Menu, Moon, Search, Sun, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { socialLinks } from "@/lib/blog";

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [location] = useLocation();
  const active = href === "/" ? location === "/" : location.startsWith(href);
  return (
    <Link href={href} className={`nav-link ${active ? "is-active" : ""}`}>
      {children}
    </Link>
  );
}

function getInitialDarkMode() {
  try {
    const stored = localStorage.getItem("zhongli-theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(getInitialDarkMode);

  useEffect(() => {
    const theme = isDark ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("zhongli-theme", theme);
  }, [isDark]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="site-rail header-rail">
        <Link href="/" className="brand-mark" aria-label="zhongli 首页" onClick={closeMenu}>
          zhongli
        </Link>
        <nav className="desktop-nav" aria-label="主要导航">
          <NavLink href="/posts">Posts</NavLink>
          <NavLink href="/about">About</NavLink>
          <NavLink href="/search"><Search size={17} /><span className="sr-only">Search</span></NavLink>
          <button className="theme-button" onClick={() => setIsDark((value) => !value)} aria-label="切换深浅色模式">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </nav>
        <div className="mobile-actions">
          <button className="theme-button" onClick={() => setIsDark((value) => !value)} aria-label="切换深浅色模式">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="打开菜单" aria-expanded={menuOpen}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="mobile-nav site-rail" aria-label="移动端导航">
          <NavLink href="/posts">Posts</NavLink>
          <NavLink href="/about">About</NavLink>
          <Link href="/search" onClick={closeMenu} className="nav-link">Search</Link>
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
        <p>钟笠 / zhongli · CC BY 4.0 · Code MIT</p>
      </div>
    </footer>
  );
}

export function PageLayout({ children }: { children: ReactNode }) {
  return <div className="site-shell"><SiteHeader /><main id="main-content" className="site-rail">{children}</main><SiteFooter /></div>;
}
