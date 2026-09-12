const form = document.getElementById("settings-form");
const apiBaseUrl = document.getElementById("apiBaseUrl");
const apiKey = document.getElementById("apiKey");
const status = document.getElementById("status");

load();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await send("settings.save", {
    settings: {
      apiBaseUrl: apiBaseUrl.value,
      apiKey: apiKey.value
    }
  });
  apiBaseUrl.value = response.apiBaseUrl;
  apiKey.value = response.apiKey;
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 1800);
});

async function load() {
  const settings = await send("settings.get");
  apiBaseUrl.value = settings.apiBaseUrl;
  apiKey.value = settings.apiKey;
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "CarrierVerify request failed."));
        return;
      }
      resolve(response.payload);
    });
  });
}
