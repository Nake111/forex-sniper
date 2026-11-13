import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View
} from "react-native";

const API_BASE = "https://forex-sniper-chat-action-bridge-production.up.railway.app";
const MARKETS = ["EURUSD", "BTCUSD", "XAUUSD"];

function decisionFor(market) {
  if (market?.approved === true && ["BUY", "SELL"].includes(market?.decision)) return market.decision;
  return "NO APPROVED TRADE";
}

export default function App() {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const request = useCallback(async (path, options = {}) => {
    if (!token.trim()) throw new Error("Enter your private bridge access key to connect.");
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token.trim()}`,
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Signal service returned HTTP ${response.status}`);
    return body;
  }, [token]);

  const loadLatest = useCallback(async () => {
    try {
      const data = await request("/latest");
      if (data?.mode !== "PAPER_RESEARCH_ONLY" || !data?.markets) {
        throw new Error("Invalid or unsafe signal response. No signal will be displayed.");
      }
      setSnapshot(data);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError(e?.message || "Unable to load verified signal snapshot.");
    }
  }, [request]);

  useEffect(() => { if (token.trim()) loadLatest(); }, [token, loadLatest]);

  const runSignal = async () => {
    setBusy(true);
    setError("");
    try {
      const accepted = await request("/run-signal", { method: "POST" });
      if (!accepted?.request_id) throw new Error("Server did not return an analysis request ID.");
      let completed = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const status = await request(`/status/${encodeURIComponent(accepted.request_id)}`);
        if (status.status === "completed") {
          completed = true;
          if (status.conclusion !== "success") throw new Error(`Analysis workflow ended: ${status.conclusion || "unknown"}`);
          break;
        }
      }
      if (!completed) throw new Error("Analysis is still running. Refresh the dashboard in a moment.");
      await loadLatest();
    } catch (e) {
      setError(e?.message || "Unable to complete analysis.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl tintColor="#7dd3fc" refreshing={false} onRefresh={loadLatest} />}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PRIVATE PAPER RESEARCH TERMINAL</Text>
          <Text style={styles.title}>FOREX SNIPER <Text style={styles.accent}>AI</Text></Text>
          <Text style={styles.subtitle}>Your Android client · Existing cloud analysis bridge</Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardLabel}>ENGINE STATUS</Text>
          <Text style={styles.statusValue}>{snapshot ? "CONNECTED" : "NOT VERIFIED"}</Text>
          <Text style={styles.muted}>Mode: PAPER / RESEARCH ONLY</Text>
          <Text style={styles.muted}>Last verified refresh: {lastRefresh ? lastRefresh.toLocaleString() : "Not available"}</Text>
        </View>

        <Text style={styles.sectionTitle}>PRIVATE ACCESS</Text>
        <TextInput value={token} onChangeText={setToken} placeholder="Paste bridge access key"
          placeholderTextColor="#64748b" secureTextEntry autoCapitalize="none" autoCorrect={false}
          style={styles.tokenInput} />
        <Text style={styles.hint}>The key is entered on your phone and is not built into the APK. Do not share it.</Text>

        <Pressable style={[styles.runButton, (busy || !token.trim()) && styles.disabled]}
          onPress={runSignal} disabled={busy || !token.trim()}>
          {busy ? <ActivityIndicator color="#06111e" /> : <Text style={styles.runText}>RUN SIGNAL ANALYSIS</Text>}
        </Pressable>
        <Pressable style={[styles.refreshButton, !token.trim() && styles.disabled]}
          onPress={loadLatest} disabled={!token.trim()}>
          <Text style={styles.refreshText}>REFRESH LATEST RESULTS</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionTitle}>MARKET DECISIONS</Text>
        {MARKETS.map(symbol => {
          const market = snapshot?.markets?.[symbol];
          const action = decisionFor(market);
          const approved = action === "BUY" || action === "SELL";
          return (
            <View key={symbol} style={styles.marketCard}>
              <View style={styles.marketTop}>
                <Text style={styles.symbol}>{symbol}</Text>
                <Text style={[styles.decision, approved && action === "BUY" ? styles.buy : approved ? styles.sell : styles.blocked]}>{action}</Text>
              </View>
              <Text style={styles.muted}>Analysis: {market?.generatedAt || snapshot?.generatedAt || "No verified cycle"}</Text>
              {Array.isArray(market?.blockers) && market.blockers.length
                ? <Text style={styles.blockers}>Blockers: {market.blockers.join(" · ")}</Text>
                : null}
              {approved
                ? <Text style={styles.levels}>Entry {market.entry ?? "—"} · SL {market.stopLoss ?? "—"} · TP {market.takeProfit ?? "—"}</Text>
                : <Text style={styles.muted}>No approved entry levels available.</Text>}
            </View>
          );
        })}
        <Text style={styles.footer}>Research only. No broker connection or orders. The app fails closed when access, data freshness or approval checks fail.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:"#07111f"},content:{padding:20,paddingBottom:36},
  header:{marginTop:24,marginBottom:22},eyebrow:{color:"#7dd3fc",fontSize:11,letterSpacing:2,fontWeight:"800"},
  title:{color:"#f8fafc",fontSize:29,fontWeight:"900",marginTop:8},accent:{color:"#38bdf8"},
  subtitle:{color:"#94a3b8",marginTop:6,fontSize:12},
  statusCard:{backgroundColor:"#101e30",borderColor:"#24364d",borderWidth:1,borderRadius:16,padding:18,marginBottom:16},
  cardLabel:{color:"#94a3b8",fontSize:11,fontWeight:"800",letterSpacing:1.4},
  statusValue:{color:"#f8fafc",fontSize:21,fontWeight:"900",marginTop:8,marginBottom:8},
  muted:{color:"#94a3b8",fontSize:12,marginTop:5},
  sectionTitle:{color:"#e2e8f0",fontSize:13,fontWeight:"900",letterSpacing:1.2,marginTop:12,marginBottom:10},
  tokenInput:{backgroundColor:"#101e30",borderColor:"#36506d",borderWidth:1,borderRadius:12,padding:14,color:"#f8fafc",fontSize:13},
  hint:{color:"#64748b",fontSize:11,lineHeight:16,marginTop:6,marginBottom:14},
  runButton:{backgroundColor:"#38bdf8",borderRadius:13,padding:17,alignItems:"center",marginBottom:9},
  runText:{color:"#06111e",fontSize:14,fontWeight:"900",letterSpacing:.5},
  refreshButton:{borderColor:"#36506d",borderWidth:1,borderRadius:12,padding:13,alignItems:"center",marginBottom:14},
  refreshText:{color:"#bae6fd",fontSize:12,fontWeight:"800"},disabled:{opacity:.45},
  error:{color:"#fbbf24",fontSize:12,lineHeight:18,marginBottom:18},
  marketCard:{backgroundColor:"#101e30",borderColor:"#24364d",borderWidth:1,borderRadius:14,padding:16,marginBottom:10},
  marketTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  symbol:{color:"#f8fafc",fontSize:16,fontWeight:"800"},
  decision:{fontSize:11,fontWeight:"900",paddingVertical:6,paddingHorizontal:9,overflow:"hidden",borderRadius:8},
  buy:{color:"#86efac",backgroundColor:"#123b2b"},sell:{color:"#fca5a5",backgroundColor:"#451f2a"},
  blocked:{color:"#fcd34d",backgroundColor:"#3c3217"},
  blockers:{color:"#fbbf24",fontSize:12,marginTop:8,lineHeight:18},
  levels:{color:"#cbd5e1",fontSize:12,marginTop:8},
  footer:{color:"#64748b",fontSize:11,lineHeight:17,marginTop:18,textAlign:"center"}
});
