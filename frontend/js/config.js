const PROD_API_BASE = "https://readyexpressnowbackend.versabold.com/api";
const localHost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

export const API_BASE = localHost ? `http://${window.location.hostname}:3000/api` : PROD_API_BASE;
