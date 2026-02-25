import { MenuItem, MenuConfig, MenuState } from "./types";

export class MenuEngine {
  private config: MenuConfig;
  private state: MenuState;
  private menuStack: { items: MenuItem[]; title: string }[] = [];

  constructor(config: MenuConfig) {
    this.config = config;
    this.state = {
      path: [],
      current: config.items,
      title: config.title,
      input: "",
    };
  }

  getState(): MenuState {
    return { ...this.state };
  }

  getConfig(): MenuConfig {
    return this.config;
  }

  navigate(key: string): MenuItem | null {
    const item = this.state.current.find(
      (m) => m.key.toLowerCase() === key.toLowerCase(),
    );
    if (!item) return null;

    if (item.type === "submenu" && item.children) {
      this.menuStack.push({
        items: this.state.current,
        title: this.state.title,
      });
      this.state.path.push(item.label);
      this.state.current = item.children;
      this.state.title = item.label;
    }

    return item;
  }

  goBack(): boolean {
    const prev = this.menuStack.pop();
    if (!prev) return false;

    this.state.path.pop();
    this.state.current = prev.items;
    this.state.title = prev.title;
    return true;
  }

  goHome(): void {
    this.menuStack = [];
    this.state.path = [];
    this.state.current = this.config.items;
    this.state.title = this.config.title;
  }

  addItem(item: MenuItem): void {
    this.config.items.push(item);
    if (this.menuStack.length === 0) {
      this.state.current = this.config.items;
    }
  }

  getCategories(): Map<string, MenuItem[]> {
    const categories = new Map<string, MenuItem[]>();
    for (const item of this.state.current) {
      const cat = item.category || "기타";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(item);
    }
    return categories;
  }
}
