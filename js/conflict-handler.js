// conflict-handler.js - 冲突检测和处理模块

/**
 * 冲突处理器
 * 用于检测和处理多设备并发修改的冲突
 */

class ConflictHandler {
  constructor(supabase, db) {
    this.supabase = supabase;
    this.db = db;
    this.SYNC_KEY = "xhs_last_sync";
    this.VERSION_KEY = "xhs_version_id";
  }

  /**
   * 获取最后同步时间
   */
  getLastSyncTime() {
    const stored = localStorage.getItem(this.SYNC_KEY);
    return stored ? new Date(stored) : null;
  }

  /**
   * 设置最后同步时间
   */
  setLastSyncTime(time = new Date()) {
    localStorage.setItem(this.SYNC_KEY, time.toISOString());
  }

  /**
   * 获取当前版本ID
   */
  getCurrentVersion() {
    return localStorage.getItem(this.VERSION_KEY);
  }

  /**
   * 设置版本ID
   */
  setCurrentVersion(versionId) {
    localStorage.setItem(this.VERSION_KEY, versionId);
  }

  /**
   * 生成唯一版本ID
   */
  generateVersionId() {
    return `v_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 检查云端是否有更新
   * @returns {Object} { hasConflict, remoteData, remoteTime }
   */
  async checkRemoteVersion() {
    try {
      const { data, error } = await this.supabase
        .from("xhsphone_snapshot")
        .select("payload, updated_at")
        .eq("key", "default")
        .maybeSingle();

      if (error) throw error;
      if (!data) return { hasConflict: false };

      const lastSync = this.getLastSyncTime();
      const remoteTime = new Date(data.updated_at);

      // 如果云端版本比最后同步时间新，说明有冲突
      const hasConflict = lastSync && remoteTime > lastSync;

      return {
        hasConflict,
        remoteData: data.payload,
        remoteTime: remoteTime,
        localSyncTime: lastSync,
      };
    } catch (err) {
      console.error("检查远程版本失败：", err);
      return { hasConflict: false, error: err };
    }
  }

  /**
   * 保存前的冲突检查
   * @returns {boolean} 是否可以继续保存
   */
  async checkBeforeSave() {
    const check = await this.checkRemoteVersion();

    if (check.error) {
      alert("无法连接到云端，请检查网络连接。");
      return false;
    }

    if (!check.hasConflict) {
      return true; // 无冲突，可以保存
    }

    // 有冲突，显示警告
    const timeDiff = Math.round(
      (check.remoteTime - check.localSyncTime) / 1000 / 60
    );

    const message = `⚠️ 检测到数据冲突！

云端版本：${this.formatTime(check.remoteTime)}
本地同步：${this.formatTime(check.localSyncTime)}
时间差：${timeDiff} 分钟前

这意味着其他设备在 ${timeDiff} 分钟前保存了新数据。

继续保存将会：
❌ 覆盖云端数据
❌ 丢失其他设备的修改

建议操作：
✅ 点击「取消」→ 先导出本地数据备份
✅ 然后「云端加载」→ 获取最新数据
✅ 手动合并后再保存

是否仍要继续保存（覆盖云端）？`;

    return confirm(message);
  }

  /**
   * 智能合并：比较两个数据集
   * @param {Array} local - 本地数据
   * @param {Array} remote - 远程数据
   * @returns {Object} 合并结果和冲突列表
   */
  smartMerge(local, remote) {
    const conflicts = [];
    const merged = new Map();

    // 建立索引
    const localMap = new Map(local.map((r) => [r.id, r]));
    const remoteMap = new Map(remote.map((r) => [r.id, r]));

    // 获取所有ID
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

    for (const id of allIds) {
      const localRow = localMap.get(id);
      const remoteRow = remoteMap.get(id);

      if (localRow && remoteRow) {
        // 双方都有，检查是否相同
        if (this.isRowEqual(localRow, remoteRow)) {
          merged.set(id, localRow); // 相同，使用任意一个
        } else {
          // 不同，记录冲突
          const mergedRow = this.mergeRow(localRow, remoteRow);
          merged.set(id, mergedRow);
          conflicts.push({
            id,
            type: "modify",
            local: localRow,
            remote: remoteRow,
            merged: mergedRow,
          });
        }
      } else if (localRow && !remoteRow) {
        // 本地有，远程无 → 本地新增
        merged.set(id, localRow);
      } else if (!localRow && remoteRow) {
        // 远程有，本地无 → 远程新增
        merged.set(id, remoteRow);
      }
    }

    return {
      merged: Array.from(merged.values()),
      conflicts,
      hasConflicts: conflicts.length > 0,
    };
  }

  /**
   * 比较两行是否相等
   */
  isRowEqual(row1, row2) {
    const fields = [
      "phone",
      "owner",
      "wx_real",
      "wx_name",
      "xhs_name",
      "note1",
      "row_color",
    ];
    return fields.every((f) => row1[f] === row2[f]);
  }

  /**
   * 合并两行数据（使用 updated_at 判断）
   */
  mergeRow(local, remote) {
    const localTime = local.updated_at || 0;
    const remoteTime = remote.updated_at || 0;

    // 使用较新的版本
    if (localTime > remoteTime) {
      return { ...local, _mergeSource: "local" };
    } else if (remoteTime > localTime) {
      return { ...remote, _mergeSource: "remote" };
    } else {
      // 时间相同，字段级合并
      return this.mergeFields(local, remote);
    }
  }

  /**
   * 字段级合并（选择非空值）
   */
  mergeFields(local, remote) {
    const merged = { ...local };
    const fields = [
      "phone",
      "owner",
      "wx_real",
      "wx_name",
      "xhs_name",
      "note1",
      "row_color",
    ];

    for (const field of fields) {
      const localVal = local[field];
      const remoteVal = remote[field];

      if (!localVal && remoteVal) {
        merged[field] = remoteVal;
      } else if (localVal && !remoteVal) {
        merged[field] = localVal;
      } else if (localVal !== remoteVal) {
        // 都有值但不同，使用较新的
        merged[field] =
          (local.updated_at || 0) > (remote.updated_at || 0)
            ? localVal
            : remoteVal;
      }
    }

    merged._mergeSource = "both";
    return merged;
  }

  /**
   * 显示冲突解决界面
   */
  async showConflictResolution(conflicts) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "conflict-modal";
      modal.innerHTML = `
        <div class="conflict-overlay"></div>
        <div class="conflict-dialog">
          <h2>🔴 检测到 ${conflicts.length} 个数据冲突</h2>
          <div class="conflict-list">
            ${conflicts
              .map(
                (c, i) => `
              <div class="conflict-item">
                <h3>冲突 ${i + 1}：记录 ${c.id.slice(0, 8)}</h3>
                <div class="conflict-compare">
                  <div class="conflict-side">
                    <h4>本地版本</h4>
                    <pre>${JSON.stringify(c.local, null, 2)}</pre>
                  </div>
                  <div class="conflict-side">
                    <h4>云端版本</h4>
                    <pre>${JSON.stringify(c.remote, null, 2)}</pre>
                  </div>
                </div>
                <div class="conflict-actions">
                  <label>
                    <input type="radio" name="resolve_${i}" value="local" checked>
                    使用本地版本
                  </label>
                  <label>
                    <input type="radio" name="resolve_${i}" value="remote">
                    使用云端版本
                  </label>
                  <label>
                    <input type="radio" name="resolve_${i}" value="merge">
                    自动合并
                  </label>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
          <div class="conflict-buttons">
            <button id="conflict-cancel" class="ghost">取消</button>
            <button id="conflict-resolve" class="primary">解决冲突</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // 绑定事件
      document.getElementById("conflict-cancel").onclick = () => {
        document.body.removeChild(modal);
        resolve(null);
      };

      document.getElementById("conflict-resolve").onclick = () => {
        const resolutions = conflicts.map((c, i) => {
          const choice = document.querySelector(
            `input[name="resolve_${i}"]:checked`
          ).value;
          return { conflict: c, choice };
        });
        document.body.removeChild(modal);
        resolve(resolutions);
      };
    });
  }

  /**
   * 格式化时间
   */
  formatTime(date) {
    if (!date) return "未知";
    const d = new Date(date);
    const now = new Date();
    const diff = Math.round((now - d) / 1000);

    if (diff < 60) return `${diff} 秒前`;
    if (diff < 3600) return `${Math.round(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.round(diff / 3600)} 小时前`;
    return `${Math.round(diff / 86400)} 天前`;
  }

  /**
   * 导出冲突报告
   */
  exportConflictReport(conflicts) {
    const report = {
      timestamp: new Date().toISOString(),
      conflicts: conflicts,
      summary: {
        total: conflicts.length,
        types: {
          modify: conflicts.filter((c) => c.type === "modify").length,
          delete: conflicts.filter((c) => c.type === "delete").length,
          add: conflicts.filter((c) => c.type === "add").length,
        },
      },
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conflict-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = ConflictHandler;
}

