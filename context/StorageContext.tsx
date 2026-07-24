import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AppSettings, FilterType, MonthlyData, Payment, PersonStats, Record, SortType, Summary } from "@/types";

const RECORDS_KEY = "lendlog_records";
const SETTINGS_KEY = "lendlog_settings";

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function todayStr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

interface StorageContextType {
  records: Record[];
  settings: AppSettings;
  loading: boolean;
  createRecord: (name: string, amount: number, type: "lent" | "borrowed", note: string, date: string, dueDate: string) => Promise<void>;
  updateRecord: (id: string, data: Partial<Record>) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  markSettled: (id: string) => Promise<void>;
  settleAllFor: (name: string) => Promise<void>;
  deleteAllFor: (name: string) => Promise<void>;
  renamePerson: (oldName: string, newName: string) => Promise<void>;
  addPayment: (recordId: string, amount: number, note: string, date: string) => Promise<void>;
  deletePayment: (recordId: string, paymentId: string) => Promise<void>;
  getFilteredRecords: (filter: FilterType, search: string, sort: SortType, person?: string) => Record[];
  getPeople: () => PersonStats[];
  getSummary: () => Summary;
  getMonthlyData: () => MonthlyData[];
  saveSettings: (s: Partial<AppSettings>) => Promise<void>;
  clearAllRecords: () => Promise<void>;
  restoreData: (records: Record[], settings: Partial<AppSettings>) => Promise<void>;
  refresh: () => Promise<void>;
}

const StorageContext = createContext<StorageContextType | null>(null);

export function StorageProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Record[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    currency: "Rs.",
    theme: "dark",
    profileName: "Friend",
  });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [rRaw, sRaw] = await Promise.all([
        AsyncStorage.getItem(RECORDS_KEY),
        AsyncStorage.getItem(SETTINGS_KEY),
      ]);
      if (rRaw) setRecords(JSON.parse(rRaw) as Record[]);
      if (sRaw) setSettings(JSON.parse(sRaw) as AppSettings);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveRecords = async (r: Record[]) => {
    setRecords(r);
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(r));
  };

  const createRecord = async (name: string, amount: number, type: "lent" | "borrowed", note: string, date: string, dueDate: string) => {
    const now = new Date().toISOString();
    const rec: Record = {
      id: genId(),
      type,
      name: name.trim(),
      amount,
      paid_amount: 0,
      note,
      date: date || todayStr(),
      due_date: dueDate,
      settled: false,
      settled_date: "",
      payments: [],
      created: now,
      updated: now,
    };
    await saveRecords([rec, ...records]);
  };

  const updateRecord = async (id: string, data: Partial<Record>) => {
    const updated = records.map(r => r.id === id ? { ...r, ...data, updated: new Date().toISOString() } : r);
    await saveRecords(updated);
  };

  const deleteRecord = async (id: string) => {
    await saveRecords(records.filter(r => r.id !== id));
  };

  const markSettled = async (id: string) => {
    const today = todayStr();
    const now = new Date().toISOString();
    const updated = records.map(r => {
      if (r.id !== id) return r;
      const isSettling = !r.settled;
      return {
        ...r,
        settled: isSettling,
        paid_amount: isSettling ? r.amount : r.paid_amount,
        settled_date: isSettling ? today : "",
        updated: now,
      };
    });
    await saveRecords(updated);
  };

  const toggleSettled = markSettled;

  const settleAllFor = async (name: string) => {
    const today = todayStr();
    const now = new Date().toISOString();
    const updated = records.map(r =>
      r.name.toLowerCase() === name.toLowerCase() && !r.settled
        ? { ...r, settled: true, settled_date: today, updated: now }
        : r
    );
    await saveRecords(updated);
  };

  const deleteAllFor = async (name: string) => {
    await saveRecords(records.filter(r => r.name.toLowerCase() !== name.toLowerCase()));
  };

  const renamePerson = async (oldName: string, newName: string) => {
    const now = new Date().toISOString();
    const updated = records.map(r =>
      r.name.toLowerCase() === oldName.toLowerCase()
        ? { ...r, name: newName.trim(), updated: now }
        : r
    );
    await saveRecords(updated);
  };

  const addPayment = async (recordId: string, amount: number, note: string, date: string) => {
    const now = new Date().toISOString();
    const payment: Payment = { id: genId(), amount, date: date || todayStr(), note };
    const updated = records.map(r => {
      if (r.id !== recordId) return r;
      const newPaid = r.paid_amount + amount;
      const autoSettle = newPaid >= r.amount;
      return {
        ...r,
        paid_amount: newPaid,
        payments: [...r.payments, payment],
        settled: autoSettle ? true : r.settled,
        settled_date: autoSettle && !r.settled ? todayStr() : r.settled_date,
        updated: now,
      };
    });
    await saveRecords(updated);
  };

  const deletePayment = async (recordId: string, paymentId: string) => {
    const now = new Date().toISOString();
    const updated = records.map(r => {
      if (r.id !== recordId) return r;
      const payments = r.payments.filter(p => p.id !== paymentId);
      const paid_amount = payments.reduce((sum, p) => sum + p.amount, 0);
      return { ...r, payments, paid_amount, updated: now };
    });
    await saveRecords(updated);
  };

  const getFilteredRecords = (filter: FilterType, search: string, sort: SortType, person?: string): Record[] => {
    let result = [...records];
    if (person) result = result.filter(r => r.name.toLowerCase() === person.toLowerCase());
    if (search.trim()) result = result.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || r.note.toLowerCase().includes(search.toLowerCase()));
    switch (filter) {
      case "lent": result = result.filter(r => r.type === "lent"); break;
      case "borrowed": result = result.filter(r => r.type === "borrowed"); break;
      case "pending": result = result.filter(r => !r.settled); break;
      case "settled": result = result.filter(r => r.settled); break;
    }
    switch (sort) {
      case "newest": result.sort((a, b) => b.created.localeCompare(a.created)); break;
      case "oldest": result.sort((a, b) => a.created.localeCompare(b.created)); break;
      case "highest": result.sort((a, b) => b.amount - a.amount); break;
      case "lowest": result.sort((a, b) => a.amount - b.amount); break;
    }
    return result;
  };

  const getPeople = (): PersonStats[] => {
    const map = new Map<string, PersonStats>();
    for (const r of records) {
      const key = r.name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { name: r.name, totalLent: 0, totalBorrowed: 0, netBalance: 0, recordCount: 0, records: [] });
      }
      const p = map.get(key)!;
      p.recordCount++;
      p.records.push(r);
      if (!r.settled) {
        if (r.type === "lent") p.totalLent += r.amount - r.paid_amount;
        else p.totalBorrowed += r.amount - r.paid_amount;
      }
    }
    for (const p of map.values()) {
      p.netBalance = p.totalLent - p.totalBorrowed;
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
  };

  const getSummary = (): Summary => {
    let totalLent = 0, totalBorrowed = 0, pendingReceivable = 0, pendingPayable = 0;
    let settledCount = 0;
    for (const r of records) {
      if (r.type === "lent") {
        totalLent += r.amount;
        if (!r.settled) pendingReceivable += r.amount - r.paid_amount;
      } else {
        totalBorrowed += r.amount;
        if (!r.settled) pendingPayable += r.amount - r.paid_amount;
      }
      if (r.settled) settledCount++;
    }
    return {
      totalLent,
      totalBorrowed,
      netBalance: pendingReceivable - pendingPayable,
      pendingReceivable,
      pendingPayable,
      settlementRate: records.length > 0 ? Math.round((settledCount / records.length) * 100) : 0,
      totalRecords: records.length,
      settledRecords: settledCount,
    };
  };

  const getMonthlyData = (): MonthlyData[] => {
    const months: MonthlyData[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("default", { month: "short" });
      months.push({ month: label, lent: 0, borrowed: 0 });
    }
    for (const r of records) {
      const parts = r.date.split("/");
      if (parts.length !== 3) continue;
      const rDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      const diffMonths = (now.getFullYear() - rDate.getFullYear()) * 12 + (now.getMonth() - rDate.getMonth());
      if (diffMonths >= 0 && diffMonths <= 5) {
        const idx = 5 - diffMonths;
        if (r.type === "lent") months[idx].lent += r.amount;
        else months[idx].borrowed += r.amount;
      }
    }
    return months;
  };

  const saveSettings = async (s: Partial<AppSettings>) => {
    const updated = { ...settings, ...s };
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  };

  const clearAllRecords = async () => {
    await saveRecords([]);
  };

  const restoreData = async (newRecords: Record[], newSettings: Partial<AppSettings>) => {
    await saveRecords(newRecords);
    await saveSettings(newSettings);
  };

  const refresh = loadData;

  return (
    <StorageContext.Provider value={{
      records, settings, loading,
      createRecord, updateRecord, deleteRecord,
      markSettled, settleAllFor, deleteAllFor, renamePerson,
      addPayment, deletePayment,
      getFilteredRecords, getPeople, getSummary, getMonthlyData,
      saveSettings, clearAllRecords, restoreData, refresh,
    }}>
      {children}
    </StorageContext.Provider>
  );
}

export function useStorage() {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error("useStorage must be used within StorageProvider");
  return ctx;
}
