const areaSenha = document.getElementById("areaSenha");
const btnConfirmar = document.getElementById("btnConfirmar");
const btnReset = document.getElementById("btnReset");
const tokenInput = document.getElementById("token");
const voltarLogin = document.getElementById("voltarLogin");
const resetAviso = document.getElementById("resetAviso");
let tokenValido = sessionStorage.getItem("reset_token_validado") || null;

// Tela de reset em 2 etapas:
// 1) validar código; 2) definir nova senha.

function exibirAreaToken() {
  if (tokenInput) {
    tokenInput.style.display = "block";
    tokenInput.value = "";
  }
  if (areaSenha) areaSenha.style.display = "none";
  if (btnReset) btnReset.style.display = "none";
  if (btnConfirmar) btnConfirmar.style.display = "block";
}

function exibirAreaSenha() {
  if (tokenInput) tokenInput.style.display = "none";
  if (areaSenha) areaSenha.style.display = "block";
  if (btnReset) btnReset.style.display = "block";
  if (btnConfirmar) btnConfirmar.style.display = "none";
}

function limparTokenValidado() {
  tokenValido = null;
  sessionStorage.removeItem("reset_token_validado");
}

function initModalPadrao() {
  // Mesmo modal padrão usado no login pra manter UX consistente.
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

async function enviarCodigoSePendente() {
  // Se veio da tela de login, já dispara envio automático do código.
  const emailPendente = sessionStorage.getItem("reset_email_pendente");
  if (!emailPendente) return;

  sessionStorage.removeItem("reset_email_pendente");

  try {
    const resp = await fetch("/api/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailPendente })
    });

    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      await abrirModal({
        titulo: "Erro",
        texto: data.erro || "Nao foi possivel enviar o codigo",
        mostrarCancelar: false
      });
      return;
    }

    if (resetAviso) {
      resetAviso.textContent = "Codigo enviado para seu e-mail. Digite-o abaixo para continuar.";
      resetAviso.style.display = "block";
    }
  } catch {
    await abrirModal({
      titulo: "Erro",
      texto: "Nao foi possivel enviar a recuperacao agora. Tente novamente.",
      mostrarCancelar: false
    });
  }
}

enviarCodigoSePendente();

if (tokenValido) {
  (async () => {
    try {
      const resp = await fetch("/api/validar-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenValido })
      });
      const data = await resp.json();

      if (resp.ok && data.ok) {
        exibirAreaSenha();
        return;
      }

      limparTokenValidado();
      exibirAreaToken();
    } catch {
      limparTokenValidado();
      exibirAreaToken();
    }
  })();
} else {
  exibirAreaToken();
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

voltarLogin?.addEventListener("click", () => {
  window.location.href = "/login.html";
});

btnConfirmar?.addEventListener("click", async () => {
  // Só libera a área de senha se o token realmente for válido.
  const token = tokenInput?.value.trim() || "";

  if (!token) {
    await abrirModal({
      titulo: "Erro",
      texto: "Informe o codigo recebido",
      mostrarCancelar: false
    });
    return;
  }

  try {
    const resp = await fetch("/api/validar-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      await abrirModal({
        titulo: "Erro",
        texto: "Codigo invalido ou expirado",
        mostrarCancelar: false
      });
      return;
    }

    tokenValido = token;
    sessionStorage.setItem("reset_token_validado", tokenValido);
    exibirAreaSenha();
  } catch (err) {
    await abrirModal({
      titulo: "Erro",
      texto: "Nao foi possivel validar o codigo.",
      mostrarCancelar: false
    });
  }
});

btnReset?.addEventListener("click", async () => {
  // Etapa final: troca senha usando token validado.
  const senha = document.getElementById("novaSenha").value;
  const confirmar = document.getElementById("confirmarSenha").value;

  console.log("TOKEN USADO:", tokenValido);

  if (!tokenValido) {
    await abrirModal({
      titulo: "Erro",
      texto: "Valide o codigo antes de redefinir a senha",
      mostrarCancelar: false
    });
    return;
  }

  if (!senha || !confirmar) {
    await abrirModal({
      titulo: "Erro",
      texto: "Preencha todos os campos",
      mostrarCancelar: false
    });
    return;
  }

  if (senha !== confirmar) {
    await abrirModal({
      titulo: "Erro",
      texto: "As senhas nao coincidem",
      mostrarCancelar: false
    });
    return;
  }

  try {
    const resp = await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenValido, senha })
    });

    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      if (data?.erro === "token expirado" || data?.erro === "token nao encontrado") {
        limparTokenValidado();
        exibirAreaToken();
      }

      await abrirModal({
        titulo: "Erro",
        texto: data?.erro || "Erro ao alterar senha",
        mostrarCancelar: false
      });
      return;
    }

    await abrirModal({
      titulo: "Sucesso",
      texto: "Senha alterada!",
      mostrarCancelar: false
    });

    limparTokenValidado();

    setTimeout(() => {
      window.location.href = "/login.html";
    }, 1500);
  } catch (err) {
    await abrirModal({
      titulo: "Erro",
      texto: "Nao foi possivel redefinir a senha.",
      mostrarCancelar: false
    });
  }
});
