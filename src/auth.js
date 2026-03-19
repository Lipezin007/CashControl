let modoCadastro = false;

// Auto-login (se houver token salvo em localStorage ou sessionStorage)
const token = localStorage.getItem("token") || sessionStorage.getItem("token");

if (token) {
  window.location.href = "/";
}

function initModalPadrao() {
  // Modal global usado como substituto de alert/confirm/prompt.
  const modal = document.querySelector("#modalPadrao");
  const modalTitulo = document.querySelector("#modalTitulo");
  const modalTexto = document.querySelector("#modalTexto");
  const modalInput = document.querySelector("#modalInput");
  const modalOk = document.querySelector("#modalOk");
  const modalCancelar = document.querySelector("#modalCancelar");

  if (!modal || !modalTitulo || !modalTexto || !modalInput || !modalOk || !modalCancelar) {
    return;
  }

  window.abrirModal = function({ titulo, texto, input = false, mostrarCancelar = true }) {
    modalTitulo.innerText = titulo;
    modalTexto.innerText = texto;
    modalInput.style.display = input ? "block" : "none";
    modalInput.value = "";
    modalCancelar.style.display = mostrarCancelar ? "inline-block" : "none";
    modal.style.display = "flex";

    return new Promise(resolve => {
      const fechar = (valor) => {
        modal.style.display = "none";
        modal.removeEventListener("click", clickFora);
        resolve(valor);
      };

      const clickFora = (e) => {
        if (e.target === modal) fechar(false);
      };

      modal.addEventListener("click", clickFora);

      modalOk.onclick = () => fechar(input ? modalInput.value.trim() : true);
      modalCancelar.onclick = () => fechar(false);
    });
  };
}

initModalPadrao();

const toggle = document.getElementById("toggleMode");
const nomeInput = document.getElementById("nome");
const confirmarSenhaBox = document.getElementById("confirmarSenhaBox");
const confirmarSenhaInput = document.getElementById("confirmarSenha");
const title = document.getElementById("formTitle");
const submitBtn = document.getElementById("submitBtn");
const form = document.getElementById("authForm");
const forgotPassword = document.getElementById("forgotPassword");

function mostrarLoadingRedirecionamentoReset() {
  // Tela simples pra evitar clique duplo enquanto troca de página.
  if (document.getElementById("loadingReset")) return;

  const overlay = document.createElement("div");
  overlay.id = "loadingReset";
  overlay.className = "loading-reset-overlay";
  overlay.innerHTML = `
    <div class="loading-reset-box">
      <div class="loading-reset-spinner" aria-hidden="true"></div>
      <p>Abrindo redefinicao de senha...</p>
    </div>
  `;

  document.body.appendChild(overlay);
}

document.querySelectorAll(".toggleSenha").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = btn.previousElementSibling;
    if (!input) return;

    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Ocultar";
    } else {
      input.type = "password";
      btn.textContent = "Mostrar";
    }
  });
});

toggle.addEventListener("click", () => {

  // Alterna entre fluxo de login e cadastro no mesmo formulário.

  modoCadastro = !modoCadastro;

  if (modoCadastro) {
    nomeInput.style.display = "block";
    confirmarSenhaBox.style.display = "flex";
    confirmarSenhaInput.required = true;
    title.textContent = "Criar Conta";
    submitBtn.textContent = "Cadastrar";
    toggle.textContent = "Já tem conta? Entrar";
  } else {
    nomeInput.style.display = "none";
    confirmarSenhaBox.style.display = "none";
    confirmarSenhaInput.required = false;
    confirmarSenhaInput.value = "";
    title.textContent = "Entrar";
    submitBtn.textContent = "Entrar";
    toggle.textContent = "Criar conta";
  }
});

forgotPassword?.addEventListener("click", async () => {
  // Pede e-mail aqui e delega envio do código pra tela de reset.
  const email = await abrirModal({
    titulo: "Recuperar senha",
    texto: "Digite seu e-mail para recuperar a senha",
    input: true,
    modo: "aviso"
  });
  if (!email) return;

  sessionStorage.setItem("reset_email_pendente", String(email).trim());
  mostrarLoadingRedirecionamentoReset();
  requestAnimationFrame(() => {
    window.location.replace("/reset.html");
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  if (modoCadastro) {
    const confirmar = confirmarSenhaInput.value;
    if (senha !== confirmar) {
      await abrirModal({
        titulo: "Erro",
        texto: "As senhas nao coincidem",
        modo: "aviso",
        mostrarCancelar: false
      });
      return;
    }

    const nome = nomeInput.value;

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, email, senha })
    });

    const data = await res.json();

    if (data.ok) {
      const loginRes = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha })
      });
      const loginData = await loginRes.json();

      if (loginData.token) {
        localStorage.setItem("token", loginData.token);
        window.location.href = "/";
      } else {
        await abrirModal({
          titulo: "Erro",
          texto: loginData.erro || "Conta criada, mas nao foi possivel fazer login automatico.",
          modo: "aviso",
          mostrarCancelar: false
        });
      }
    } else {
      await abrirModal({
        titulo: "Erro",
        texto: data.erro,
        modo: "aviso",
        mostrarCancelar: false
      });
    }

  } else {

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha })
    });

    const data = await res.json();

   if (data.token) {

  const lembrar = document.getElementById("lembrar")?.checked;

  if (lembrar) {
    localStorage.setItem("token", data.token); // 🔥 fica salvo
  } else {
    sessionStorage.setItem("token", data.token); // 🔥 só sessão
  }

  window.location.href = "/";
} else {
      await abrirModal({
        titulo: "Erro",
        texto: data.erro,
        modo: "aviso",
        mostrarCancelar: false
      });
    }
  }
});
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) return res.status(401).send("Unauthorized");

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).send("Invalid token");
  }
}