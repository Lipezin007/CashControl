(() => {
  "use strict";

  // ===== STATE =====
  const state = {
    open: false,
    loading: false,
    history: [] // { role: "user"|"assistant", content: string }
  };

  // ===== DOM REFS (populated after DOMContentLoaded) =====
  let elPanel, elMessages, elInput, elSendBtn, elToggleBtn, elClearBtn;

  // ===== AUTH TOKEN =====
  function getToken() {
    return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
  }

  // ===== API CALL =====
  async function callLion(userMessage) {
    state.history.push({ role: "user", content: userMessage });

    const resp = await fetch("/api/lion/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken()
      },
      body: JSON.stringify({ messages: state.history })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ erro: "Erro desconhecido" }));
      throw new Error(err.erro || "Falha na comunicação com o servidor");
    }

    const data = await resp.json();
    const answer = data.resposta || "Não entendi, pode repetir?";
    state.history.push({ role: "assistant", content: answer });
    return answer;
  }

  // ===== RENDER =====
  function renderMessages() {
    elMessages.innerHTML = "";

    if (state.history.length === 0) {
      elMessages.innerHTML = `
        <div class="lion-empty">
          <div class="lion-avatar-big">🦁</div>
          <p>Olá! Sou o <strong>Lion</strong>, seu assistente financeiro.</p>
          <p>Posso te ajudar a ver seu resumo, criar transações, gerenciar caixinhas e muito mais.</p>
          <div class="lion-suggestions">
            <button class="lion-suggestion" data-msg="Qual é meu resumo financeiro deste mês?">📊 Resumo do mês</button>
            <button class="lion-suggestion" data-msg="Quais são meus gastos por categoria este mês?">🏷️ Gastos por categoria</button>
            <button class="lion-suggestion" data-msg="Liste minhas caixinhas de poupança">🐷 Minhas caixinhas</button>
            <button class="lion-suggestion" data-msg="Liste minhas categorias disponíveis">📂 Categorias</button>
          </div>
        </div>`;

      elMessages.querySelectorAll(".lion-suggestion").forEach(btn => {
        btn.addEventListener("click", () => sendMessage(btn.dataset.msg));
      });
      return;
    }

    state.history.forEach(msg => {
      const div = document.createElement("div");
      div.className = "lion-msg lion-msg--" + msg.role;

      if (msg.role === "assistant") {
        div.innerHTML = `<span class="lion-msg-avatar">🦁</span><div class="lion-msg-bubble">${formatMarkdown(msg.content)}</div>`;
      } else {
        div.innerHTML = `<div class="lion-msg-bubble">${escapeHtml(msg.content)}</div>`;
      }

      elMessages.appendChild(div);
    });

    if (state.loading) {
      const div = document.createElement("div");
      div.className = "lion-msg lion-msg--assistant";
      div.innerHTML = `<span class="lion-msg-avatar">🦁</span><div class="lion-msg-bubble lion-typing"><span></span><span></span><span></span></div>`;
      elMessages.appendChild(div);
    }

    elMessages.scrollTop = elMessages.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatMarkdown(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  // ===== SEND =====
  async function sendMessage(text) {
    const msg = (text || elInput.value).trim();
    if (!msg || state.loading) return;

    elInput.value = "";
    state.loading = true;
    renderMessages();
    setInputDisabled(true);

    try {
      await callLion(msg);
    } catch (err) {
      state.history.push({
        role: "assistant",
        content: "⚠️ Erro: " + err.message
      });
    } finally {
      state.loading = false;
      setInputDisabled(false);
      renderMessages();
      elInput.focus();
    }
  }

  function setInputDisabled(disabled) {
    elInput.disabled = disabled;
    elSendBtn.disabled = disabled;
  }

  // ===== PANEL TOGGLE =====
  function togglePanel() {
    state.open = !state.open;
    elPanel.classList.toggle("lion-panel--open", state.open);
    elToggleBtn.classList.toggle("lion-toggle--active", state.open);
    if (state.open) {
      renderMessages();
      setTimeout(() => elInput.focus(), 100);
    }
  }

  function clearHistory() {
    state.history = [];
    renderMessages();
  }

  // ===== INIT =====
  function init() {
    elPanel = document.getElementById("lion-panel");
    elMessages = document.getElementById("lion-messages");
    elInput = document.getElementById("lion-input");
    elSendBtn = document.getElementById("lion-send");
    elToggleBtn = document.getElementById("lion-toggle");
    elClearBtn = document.getElementById("lion-clear");

    if (!elPanel) return;

    elToggleBtn.addEventListener("click", togglePanel);
    elClearBtn.addEventListener("click", clearHistory);

    elSendBtn.addEventListener("click", () => sendMessage());

    elInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    renderMessages();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
