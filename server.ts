import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WORKSPACE_ID,
  batchCreateTransactions,
  deleteEmployee,
  deleteTransaction,
  getWorkspaceSnapshot,
  replaceWorkspaceData,
  syncPendingMutationsBatch,
  updateWorkspaceSettings,
  upsertEmployee,
  upsertTransaction,
} from './src/db/workspaceRepo.ts';
import { requireAuth } from './src/middleware/auth.ts';
import type { AuthRequest } from './src/middleware/auth.ts';
import type { AppState, HistoryEntry, MasterEmployee, Transaction } from './src/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/workspace', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const snapshot = await getWorkspaceSnapshot(DEFAULT_WORKSPACE_ID);
    res.json(snapshot);
  } catch (error) {
    console.error('GET /api/workspace failed:', error);
    res.status(500).json({ error: 'Gagal memuat data ruang kerja.' });
  }
});

app.post('/api/transactions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { transaction, historyEntry } = req.body as {
      transaction?: Transaction;
      historyEntry?: HistoryEntry;
    };
    if (!transaction || !transaction.id || !transaction.nama) {
      res.status(400).json({ error: 'Data transaksi tidak lengkap.' });
      return;
    }
    await upsertTransaction(
      transaction,
      req.user?.uid || '',
      historyEntry,
      DEFAULT_WORKSPACE_ID
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/transactions failed:', error);
    res.status(500).json({ error: 'Gagal menyimpan data SPJ.' });
  }
});

app.post('/api/transactions/batch', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { transactions, historyEntry } = req.body as {
      transactions?: Transaction[];
      historyEntry?: HistoryEntry;
    };
    if (!Array.isArray(transactions)) {
      res.status(400).json({ error: 'Daftar transaksi tidak valid.' });
      return;
    }
    await batchCreateTransactions(
      transactions,
      req.user?.uid || '',
      historyEntry,
      DEFAULT_WORKSPACE_ID
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/transactions/batch failed:', error);
    res.status(500).json({ error: 'Gagal menyimpan salinan transaksi.' });
  }
});

app.delete('/api/transactions/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;
    const { historyEntry } = (req.body || {}) as { historyEntry?: HistoryEntry };
    if (!id) {
      res.status(400).json({ error: 'ID transaksi tidak ditemukan.' });
      return;
    }
    await deleteTransaction(id, req.user?.uid || '', historyEntry, DEFAULT_WORKSPACE_ID);
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/transactions/:id failed:', error);
    res.status(500).json({ error: 'Gagal menghapus transaksi.' });
  }
});

app.post('/api/employees', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { employee, historyEntry } = req.body as {
      employee?: MasterEmployee;
      historyEntry?: HistoryEntry;
    };
    if (!employee || !employee.id || !employee.nama) {
      res.status(400).json({ error: 'Data pegawai master tidak lengkap.' });
      return;
    }
    await upsertEmployee(employee, req.user?.uid || '', historyEntry, DEFAULT_WORKSPACE_ID);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/employees failed:', error);
    res.status(500).json({ error: 'Gagal menyimpan pegawai master.' });
  }
});

app.delete('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;
    const { historyEntry } = (req.body || {}) as { historyEntry?: HistoryEntry };
    if (!id) {
      res.status(400).json({ error: 'ID pegawai tidak ditemukan.' });
      return;
    }
    await deleteEmployee(id, req.user?.uid || '', historyEntry, DEFAULT_WORKSPACE_ID);
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/employees/:id failed:', error);
    res.status(500).json({ error: 'Gagal menghapus pegawai master.' });
  }
});

app.put('/api/settings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { settings, historyEntry } = req.body as {
      settings?: Parameters<typeof updateWorkspaceSettings>[0];
      historyEntry?: HistoryEntry;
    };
    if (!settings) {
      res.status(400).json({ error: 'Pengaturan tidak ditemukan.' });
      return;
    }
    await updateWorkspaceSettings(
      settings,
      req.user?.uid || '',
      historyEntry,
      DEFAULT_WORKSPACE_ID
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/settings failed:', error);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan.' });
  }
});

app.post('/api/workspace/import', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { state, historyEntry } = req.body as {
      state?: AppState;
      historyEntry?: HistoryEntry;
    };
    if (!state || !Array.isArray(state.transactions) || !Array.isArray(state.masterEmployees)) {
      res.status(400).json({ error: 'Struktur data impor tidak valid.' });
      return;
    }
    await replaceWorkspaceData(state, req.user?.uid || '', historyEntry, DEFAULT_WORKSPACE_ID);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/workspace/import failed:', error);
    res.status(500).json({ error: 'Gagal memulihkan data impor.' });
  }
});

app.post('/api/workspace/reset', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { state, historyEntry } = req.body as {
      state?: AppState;
      historyEntry?: HistoryEntry;
    };
    if (!state || !Array.isArray(state.transactions) || !Array.isArray(state.masterEmployees)) {
      res.status(400).json({ error: 'Struktur data reset tidak valid.' });
      return;
    }
    await replaceWorkspaceData(state, req.user?.uid || '', historyEntry, DEFAULT_WORKSPACE_ID);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/workspace/reset failed:', error);
    res.status(500).json({ error: 'Gagal mengatur ulang data awal.' });
  }
});

app.post('/api/workspace/sync-pending', requireAuth, async (req: AuthRequest, res) => {
  try {
    await syncPendingMutationsBatch(
      req.body || {},
      req.user?.uid || '',
      DEFAULT_WORKSPACE_ID
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/workspace/sync-pending failed:', error);
    res.status(500).json({ error: 'Gagal menyinkronkan perubahan tertunda.' });
  }
});

app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
});

if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const distDir = path.join(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
