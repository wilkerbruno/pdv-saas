import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, brl, loadToken, setToken } from './src/api';

interface Variant { id: string; priceCents: number; stockQty: number; attributes?: Record<string, string> | null; product: { name: string } }
interface Line { variant: Variant; qty: number }
interface Payment { id: string; status: string; pixQrBase64?: string | null; pixCopyPaste?: string | null; provider: string }
interface Sale { id: string; number: number; status: string; totalCents: number; payments: Payment[] }

const name = (v: Variant) => {
  const a = v.attributes ? Object.values(v.attributes).join(' / ') : '';
  return a ? `${v.product.name} (${a})` : v.product.name;
};

// Formas de receber disponíveis nesta versão do app. Juros de parcelamento: use a versão web por enquanto.
const WAYS = [
  { key: 'cash', label: 'Dinheiro', method: 'CASH', provider: 'MANUAL' },
  { key: 'pix', label: 'PIX QR Code', method: 'PIX', provider: 'MERCADOPAGO_PIX' },
  { key: 'debit', label: 'Débito (maquininha MP)', method: 'DEBIT', provider: 'MERCADOPAGO_POINT' },
  { key: 'card', label: 'Cartão — cliente já pagou', method: 'CREDIT', provider: 'MANUAL' },
] as const;

export default function App() {
  const [ready, setReady] = useState(false);
  const [logged, setLogged] = useState(false);
  useEffect(() => { loadToken().then((ok) => { setLogged(ok); setReady(true); }); }, []);
  if (!ready) return <ActivityIndicator style={{ flex: 1 }} />;
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="auto" />
      {logged ? <Pos onLogout={() => setToken(null).then(() => setLogged(false))} /> : <Login onDone={() => setLogged(true)} />}
    </SafeAreaView>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const go = async () => {
    try {
      const r = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
      await setToken(r.token);
      onDone();
    } catch (e) { Alert.alert('Não foi possível entrar', (e as Error).message); }
  };
  return (
    <View style={s.pad}>
      <Text style={s.h1}>PDV</Text>
      <TextInput style={s.input} placeholder="E-mail" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={s.input} placeholder="Senha" secureTextEntry value={password} onChangeText={setPassword} />
      <Pressable style={s.primary} onPress={go}><Text style={s.primaryText}>Entrar</Text></Pressable>
    </View>
  );
}

function Pos({ onLogout }: { onLogout: () => void }) {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [cashOpen, setCashOpen] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Variant[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [scan, setScan] = useState(false);
  const [pay, setPay] = useState(false);
  const [cpf, setCpf] = useState('');
  const [sale, setSale] = useState<Sale | null>(null);
  const [perm, askPerm] = useCameraPermissions();

  const total = cart.reduce((t, l) => t + l.variant.priceCents * l.qty, 0);

  useEffect(() => {
    (async () => {
      const me = await api('/auth/me');
      setStoreId(me.tenant.stores[0]?.id ?? null);
      const c = await api('/cash/current');
      setCashOpen(!!c.session);
    })().catch((e) => Alert.alert('Erro', e.message));
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => api<Variant[]>(`/variants/search?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const add = (v: Variant) => setCart((c) => {
    const i = c.findIndex((l) => l.variant.id === v.id);
    return i >= 0 ? c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) : [...c, { variant: v, qty: 1 }];
  });

  const onScanned = async (code: string) => {
    setScan(false);
    try { add(await api<Variant>(`/variants/lookup?code=${encodeURIComponent(code)}`)); }
    catch { Alert.alert('Código não encontrado', code); }
  };

  const openCash = async () => {
    try { await api('/cash/open', { method: 'POST', body: { storeId, openingCents: 0 } }); setCashOpen(true); }
    catch (e) { Alert.alert('Erro', (e as Error).message); }
  };

  const charge = async (w: (typeof WAYS)[number]) => {
    try {
      const body = { storeId, items: cart.map((l) => ({ variantId: l.variant.id, qty: l.qty })), payments: [{ method: w.method, provider: w.provider, amountCents: total }], ...(cpf.replace(/\D/g, '') ? { consumerDocument: cpf.replace(/\D/g, '') } : {}) };
      const created = await api<Sale>('/sales', { method: 'POST', body });
      setPay(false);
      setSale(created);
      if (created.status === 'PAID') { setCart([]); setCpf(''); }
    } catch (e) { Alert.alert('Não foi possível cobrar', (e as Error).message); }
  };

  // Enquanto PIX/maquininha estiverem pendentes, consulta o servidor a cada 3 s.
  useEffect(() => {
    if (!sale || sale.status !== 'PENDING') return;
    const t = setInterval(() => {
      api<Sale>(`/sales/${sale.id}/refresh`, { method: 'POST' }).then((x) => { setSale(x); if (x.status === 'PAID') { setCart([]); setCpf(''); } }).catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [sale]);

  if (cashOpen === null) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!cashOpen) return (
    <View style={s.pad}>
      <Text style={s.h1}>Caixa fechado</Text>
      <Pressable style={s.primary} onPress={openCash}><Text style={s.primaryText}>Abrir caixa</Text></Pressable>
      <Pressable onPress={onLogout}><Text style={s.link}>Sair</Text></Pressable>
    </View>
  );

  return (
    <View style={s.pad}>
      <View style={s.row}>
        <TextInput style={[s.input, { flex: 1 }]} placeholder="Buscar produto" value={q} onChangeText={setQ} />
        <Pressable style={s.secondary} onPress={async () => { if (!perm?.granted) await askPerm(); setScan(true); }}><Text>📷</Text></Pressable>
      </View>
      {results.length > 0 && (
        <FlatList style={{ maxHeight: 180 }} data={results} keyExtractor={(v) => v.id}
          renderItem={({ item }) => (
            <Pressable style={s.item} onPress={() => { add(item); setQ(''); setResults([]); }}>
              <Text style={{ flex: 1 }}>{name(item)}</Text><Text style={s.bold}>{brl(item.priceCents)}</Text>
            </Pressable>
          )} />
      )}
      <FlatList style={{ flex: 1 }} data={cart} keyExtractor={(l) => l.variant.id}
        ListEmptyComponent={<Text style={s.muted}>Nenhum item. Busque ou leia o código de barras.</Text>}
        renderItem={({ item }) => (
          <View style={s.item}>
            <Text style={{ flex: 1 }}>{name(item.variant)}</Text>
            <Pressable onPress={() => setCart((c) => c.flatMap((l) => (l.variant.id !== item.variant.id ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : [])))}><Text style={s.qty}>−</Text></Pressable>
            <Text>{item.qty}</Text>
            <Pressable onPress={() => add(item.variant)}><Text style={s.qty}>+</Text></Pressable>
            <Text style={[s.bold, { width: 90, textAlign: 'right' }]}>{brl(item.variant.priceCents * item.qty)}</Text>
          </View>
        )} />
      <Pressable style={[s.primary, cart.length === 0 && { opacity: 0.5 }]} disabled={cart.length === 0} onPress={() => setPay(true)}>
        <Text style={s.primaryText}>Pagar {brl(total)}</Text>
      </Pressable>

      <Modal visible={scan} animationType="slide" onRequestClose={() => setScan(false)}>
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'upc_a'] }}
          onBarcodeScanned={({ data }) => onScanned(data)} />
        <Pressable style={s.primary} onPress={() => setScan(false)}><Text style={s.primaryText}>Fechar</Text></Pressable>
      </Modal>

      <Modal visible={pay} transparent animationType="fade" onRequestClose={() => setPay(false)}>
        <View style={s.backdrop}><View style={s.sheet}>
          <Text style={s.h1}>Receber {brl(total)}</Text>
          <TextInput style={s.input} placeholder="CPF/CNPJ na nota (opcional)" keyboardType="number-pad" value={cpf} onChangeText={setCpf} />
          {WAYS.map((w) => <Pressable key={w.key} style={s.secondary} onPress={() => charge(w)}><Text>{w.label}</Text></Pressable>)}
          <Pressable onPress={() => setPay(false)}><Text style={s.link}>Cancelar</Text></Pressable>
        </View></View>
      </Modal>

      <Modal visible={!!sale} transparent animationType="fade" onRequestClose={() => setSale(null)}>
        <View style={s.backdrop}><View style={s.sheet}>
          {sale?.status === 'PAID' ? <Text style={s.h1}>Venda #{sale.number} paga ✅</Text> : <Text style={s.h1}>Aguardando pagamento…</Text>}
          {sale?.payments.map((p) => p.pixQrBase64 && p.status === 'PENDING' ? (
            <View key={p.id} style={{ alignItems: 'center' }}>
              <Image style={{ width: 220, height: 220 }} source={{ uri: `data:image/png;base64,${p.pixQrBase64}` }} />
              <Text selectable style={s.muted}>{p.pixCopyPaste}</Text>
            </View>) : null)}
          {sale?.status === 'PENDING' && sale.payments.some((p) => p.provider === 'MERCADOPAGO_POINT') && <Text style={s.muted}>Siga na maquininha. O app reconhece o pagamento sozinho.</Text>}
          <Pressable style={s.primary} onPress={() => setSale(null)}><Text style={s.primaryText}>{sale?.status === 'PAID' ? 'Nova venda' : 'Fechar'}</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f4f5f7' },
  pad: { flex: 1, padding: 16, gap: 10 },
  h1: { fontSize: 22, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e3e6ea', fontSize: 16 },
  primary: { backgroundColor: '#0f766e', borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { backgroundColor: '#fff', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e3e6ea' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e3e6ea' },
  bold: { fontWeight: '700' },
  qty: { fontSize: 22, paddingHorizontal: 8 },
  muted: { color: '#64707d' },
  link: { color: '#0f766e', textAlign: 'center', padding: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 16, gap: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
