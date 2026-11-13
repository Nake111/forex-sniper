import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, View
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL;
const MARKETS = ["EURUSD", "BTCUSD", "XAUUSD"];

function displayDecision(market) {
  if (market?.approved === true && ["BUY", "SELL"].includes(market?.action)) return market.action;
  return "NO APPROVED TRADE";
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadLatest = useCallback(async () => {
    if (!API_BASE || API_BASE.includes("REPLACE_WITH")) {
      setError("Mobile API is not connected yet. The secure cloud gateway must be deployed first.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/v1/signals/latest`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Signal service returned HTTP ${response.status}`);
      const data = await response.json();
      if (data?.mode !== "PAPER_RESEARCH_ONLY" || !data?.markets) {
        throw new Error("Invalid or unsafe signal response. No signal will be displayed.");
      }
      setSnapshot(data);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError(e?.message || "Unable to load verified signal snapshot.");
    }
  }, []);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const runSignal = async () => {
    if (!API_BASE || API_BASE.includes("REPLACE_WITH")) {
      setError("The secure mobile API gateway has not been deployed yet.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/v1/signals/run`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" }
      });
      if (!response.ok) throw new Error(`Signal request failed (HTTP ${response.status})`);
      const result = await response.json();
      if (!result?.request_id) throw new Error("Server did not return an analysis request ID.");
      setError("Analysis accepted. Waiting for the matching verified cycle; refresh shortly.");
    } catch (e) {
      setError(e?.message || "Unable to start analysis.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor="#7dd3fc" refreshing={false} onRefresh={loadLatest} />}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PAPER RESEARCH TERMINAL</Text>
          <Text style={styles.title}>FOREX SNIPER <Text style={styles.accent}>AI</Text></Text>
          <Text style={styles.subtitle}>Independent Android client · Cloud analysis engine</Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardLabel}>ENGINE STATUS</Text>
          <Text style={styles.statusValue}>{snapshot ? "CONNECTED" : "NOT VERIFIED"}</Text>
          <Text style={styles.muted}>Mode: PAPER / RESEARCH ONLY</Text>
          <Text style={styles.muted}>Last verified refresh: {lastRefresh ? lastRefresh.toLocaleString() : "Not available"}</Text>
        </View>

        <Pressable style={[styles.runButton, busy && styles.disabled]} onPress={runSignal} disabled={busy}>
          {busy ? <ActivityIndicator color="#06111e" /> : <Text style={styles.runText}>RUN SIGNAL ANALYSIS</Text>}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionTitle}>MARKET DECISIONS</Text>
        {MARKETS.map((symbol) => {
          const market = snapshot?.markets?.[symbol] ?? snapshot?.markets?.[symbol.toLowerCase()];
          const action = displayDecision(market);
          const approved = action === "BUY" || action === "SELL";
          return (
            <View key={symbol} style={styles.marketCard}>
              <View style={styles.marketTop}>
                <Text style={styles.symbol}>{symbol}</Text>
                <Text style={[styles.decision, approved && action === "BUY" ? styles.buy : approved ? styles.sell : styles.blocked]}>
                  {action}
                </Text>
              </View>
              <Text style={styles.muted}>Analysis: {market?.generatedAt || snapshot?.generatedAt || "No verified cycle"}</Text>
              {Array.isArray(market?.blockers) && market.blockers.length > 0
                ? <Text style={styles.blockers}>Blockers: {market.blockers.join(" · ")}</Text>
                : null}
              {approved ? (
                <Text style={styles.levels}>Entry {market.entry ?? "—"}  ·  SL {market.stopLoss ?? "—"}  ·  TP {market.takeProfit ?? "—"}</Text>
              ) : <Text style={styles.muted}>No approved entry levels are available.</Text>}
            </View>
          );
        })}

        <Text style={styles.footer}>Reference research only. No broker connection or orders. Recheck current market quotes and risk independently.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07111f" },
  content: { padding: 20, paddingBottom: 36 },
  header: { marginTop: 24, marginBottom: 22 },
  eyebrow: { color: "#7dd3fc", fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  title: { color: "#f8fafc", fontSize: 29, fontWeight: "900", marginTop: 8 },
  accent: { color: "#38bdf8" },
  subtitle: { color: "#94a3b8", marginTop: 6, fontSize: 12 },
  statusCard: { backgroundColor: "#101e30", borderColor: "#24364d", borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 16 },
  cardLabel: { color: "#94a3b8", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  statusValue: { color: "#f8fafc", fontSize: 21, fontWeight: "900", marginTop: 8, marginBottom: 8 },
  muted: { color: "#94a3b8", fontSize: 12, marginTop: 5 },
  runButton: { backgroundColor: "#38bdf8", borderRadius: 13, padding: 17, alignItems: "center", marginBottom: 14 },
  runText: { color: "#06111e", fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  disabled: { opacity: 0.6 },
  error: { color: "#fbbf24", fontSize: 12, lineHeight: 18, marginBottom: 18 },
  sectionTitle: { color: "#e2e8f0", fontSize: 13, fontWeight: "900", letterSpacing: 1.2, marginTop: 12, marginBottom: 10 },
  marketCard: { backgroundColor: "#101e30", borderColor: "#24364d", borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 10 },
  marketTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  symbol: { color: "#f8fafc", fontSize: 16, fontWeight: "800" },
  decision: { fontSize: 11, fontWeight: "900", paddingVertical: 6, paddingHorizontal: 9, overflow: "hidden", borderRadius: 8 },
  buy: { color: "#86efac", backgroundColor: "#123b2b" },
  sell: { color: "#fca5a5", backgroundColor: "#451f2a" },
  blocked: { color: "#fcd34d", backgroundColor: "#3c3217" },
  blockers: { color: "#fbbf24", fontSize: 12, marginTop: 8, lineHeight: 18 },
  levels: { color: "#cbd5e1", fontSize: 12, marginTop: 8 },
  footer: { color: "#64748b", fontSize: 11, lineHeight: 17, marginTop: 18, textAlign: "center" }
});
