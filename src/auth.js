let modoCadastro = false;

const toggle = document.getElementById("toggleMode");
const nomeInput = document.getElementById("nome");
const title = document.getElementById("formTitle");
const submitBtn = document.getElementById("submitBtn");
const form = document.getElementById("authForm");

toggle.addEventListener("click", () => {

  modoCadastro = !modoCadastro;

  if (modoCadastro) {
    nomeInput.style.display = "block";
    title.textContent = "Criar Conta";
    submitBtn.textContent = "Cadastrar";
    toggle.textContent = "Já tem conta? Entrar";
  } else {
    nomeInput.style.display = "none";
    title.textContent = "Entrar";
    submitBtn.textContent = "Entrar";
    toggle.textContent = "Criar conta";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  if (modoCadastro) {

    const nome = nomeInput.value;

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, email, senha })
    });

    const data = await res.json();

    if (data.ok) {
      alert("Conta criada com sucesso!");
      modoCadastro = false;
      toggle.click();
    } else {
      alert(data.erro);
    }

  } else {

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha })
    });

    const data = await res.json();

    if (data.token) {
      localStorage.setItem("token", data.token);
      window.location.href = "/";
    } else {
      alert(data.erro);
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