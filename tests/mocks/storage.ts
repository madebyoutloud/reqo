class Storage {
  items = new Map<string, string>()

  setItem(key: string, value: string) {
    this.items.set(key, value)
  }

  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  removeItem(key: string) {
    this.items.delete(key)
  }

  get length() {
    return this.items.size
  }

  key(i: number) {
    return this.items.keys()
      .toArray()[i] ?? null
  }

  clear() {
    this.items.clear()
  }
}

globalThis.localStorage = new Storage()
