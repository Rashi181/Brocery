// Shared app state.
//
// PERSON 1: your AR component reads `budget`, `remaining`, `currentAisle`
// and `pendingItems` from here, and calls confirmItem / substituteItem /
// skipItem. You never need to call the API directly.
//
//   import { useStore } from "../store";
//   const { remaining, pendingItems, confirmItem } = useStore();

import { create } from "zustand";
import { api } from "./api";

export const useStore = create((set, get) => ({
  // --- data ---
  contractId: null,
  tripId: null,
  items: [],          // parsed contract items, editable before trip start
  aisles: [],         // [{ aisle, aisle_no, items: [] }]
  currentAisleNo: null,
  budget: 0,
  spent: 0,
  remaining: 0,
  overBudget: false,
  lines: [],          // cart lines
  loading: false,
  error: null,

  // --- derived ---
  get currentAisle() {
    const { aisles, currentAisleNo } = get();
    return aisles.find((a) => a.aisle_no === currentAisleNo) || null;
  },

  get pendingItems() {
    const a = get().currentAisle;
    if (!a) return [];
    const done = new Set(
      get().lines.filter((l) => l.status !== "pending").map((l) => l.item_id)
    );
    return a.items.filter((it) => !done.has(it.id));
  },

  // --- actions ---
  setError: (error) => set({ error }),

  async parseChat(rawText) {
    set({ loading: true, error: null });
    try {
      const res = await api.parseChat(rawText);
      set({ contractId: res.contract_id, items: res.items });
      return res;
    } catch (e) {
      set({ error: e.message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  // local edit on the review screen, before the trip starts
  updateItem(id, patch) {
    set({
      items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  },

  removeItem(id) {
    set({ items: get().items.filter((it) => it.id !== id) });
  },

  async startTrip(budget) {
    set({ loading: true, error: null });
    try {
      const { contractId } = get();
      const res = await api.startTrip(contractId, budget);
      const aisleRes = await api.getAisles(contractId);
      const cart = await api.getCart(res.trip_id);
      set({
        tripId: res.trip_id,
        budget: res.budget,
        aisles: aisleRes.aisles,
        currentAisleNo: aisleRes.aisles[0]?.aisle_no ?? null,
        spent: cart.spent,
        remaining: cart.remaining,
        overBudget: cart.over_budget,
        lines: cart.lines,
      });
      return res;
    } catch (e) {
      set({ error: e.message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  setCurrentAisle(aisle_no) {
    set({ currentAisleNo: aisle_no });
  },

  applyCart(cart) {
    set({
      budget: cart.budget,
      spent: cart.spent,
      remaining: cart.remaining,
      overBudget: cart.over_budget,
      lines: cart.lines,
    });
  },

  async confirmItem(itemId, productName, price) {
    const cart = await api.confirmItem(get().tripId, itemId, productName, price);
    get().applyCart(cart);
    return cart;
  },

  async substituteItem(itemId, productName, price, reason) {
    const cart = await api.substituteItem(
      get().tripId, itemId, productName, price, reason
    );
    get().applyCart(cart);
    return cart;
  },

  async skipItem(itemId, reason) {
    const cart = await api.skipItem(get().tripId, itemId, reason);
    get().applyCart(cart);
    return cart;
  },

  async refreshCart() {
    const cart = await api.getCart(get().tripId);
    get().applyCart(cart);
    return cart;
  },

  reset() {
    set({
      contractId: null, tripId: null, items: [], aisles: [],
      currentAisleNo: null, budget: 0, spent: 0, remaining: 0,
      overBudget: false, lines: [], error: null,
    });
  },
}));