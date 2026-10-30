
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>

// =============== WIFI SETTINGS ===============
const char* WIFI_SSID = "Network";
const char* WIFI_PASSWORD = "11111111";

// =============== WEBSITE API =================
const char* API_BASE_URL =
  "https://website-iota-neon-f8wki3ldia.vercel.app";

// =============== RFID PINS ===================
#define RFID_SS_PIN   5
#define RFID_RST_PIN  22
#define RFID_SCK_PIN  18
#define RFID_MISO_PIN 19
#define RFID_MOSI_PIN 23

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

WiFiClientSecure tlsClient;
WiFiClient plainClient;

// =============== SESSION DATA =================
String activeStudentId = "";
String activeStudentName = "";
bool waitingForBook = false;

String lastProcessedUID = "";
unsigned long lastProcessedTime = 0;
const unsigned long SCAN_COOLDOWN_MS = 1500;

// =============== API URL ======================
String apiBase() {
  String base = String(API_BASE_URL);

  while (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }

  return base;
}

String apiUrl(const String& path) {
  if (path.startsWith("/")) {
    return apiBase() + path;
  }

  return apiBase() + "/" + path;
}

// =============== HTTP INITIALIZATION ==========
bool beginHttp(HTTPClient& http, const String& url) {
  http.setConnectTimeout(10000);
  http.setTimeout(15000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  if (url.startsWith("https://")) {
    return http.begin(tlsClient, url);
  }

  return http.begin(plainClient, url);
}

// =============== HTTP RESPONSE =================
void printHttpResult(int status, const String& response) {
  Serial.print("[HTTP] Status: ");
  Serial.println(status);

  if (response.length() > 0) {
    Serial.println("[HTTP] Response:");
    Serial.println(response);
  }

  if (status == 404 &&
      response.indexOf("No route for") >= 0) {
    Serial.println("[API ERROR] Vercel API route is not resolving.");
    Serial.println("[API ERROR] Check the website/api/*.js functions");
  }
  else if (status == 404) {
    Serial.println("[API ERROR] Endpoint or registered UID not found.");
  }
  else if (status >= 500) {
    Serial.println("[API ERROR] Server error.");
  }
}

// =============== POST JSON =====================
bool postJson(
  const String& path,
  const String& payload,
  String& responseBody,
  int& statusCode
) {
  responseBody = "";
  statusCode = -1;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Not connected.");
    return false;
  }

  String url = apiUrl(path);

  HTTPClient http;

  Serial.println();
  Serial.println("[HTTP] POST " + url);

  if (!beginHttp(http, url)) {
    Serial.println("[HTTP] Request initialization failed.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");

  statusCode = http.POST(payload);

  if (statusCode > 0) {
    responseBody = http.getString();
  } else {
    Serial.print("[HTTP] Error: ");
    Serial.println(http.errorToString(statusCode));
  }

  http.end();

  printHttpResult(statusCode, responseBody);

  return statusCode >= 200 && statusCode < 300;
}

// =============== GET JSON ======================
bool getJson(
  const String& path,
  String& responseBody,
  int& statusCode
) {
  responseBody = "";
  statusCode = -1;

  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  String url = apiUrl(path);

  HTTPClient http;

  Serial.println("[HTTP] GET " + url);

  if (!beginHttp(http, url)) {
    return false;
  }

  statusCode = http.GET();

  if (statusCode > 0) {
    responseBody = http.getString();
  }

  http.end();

  printHttpResult(statusCode, responseBody);

  return statusCode >= 200 && statusCode < 300;
}

// =============== UID CONVERSION ================
String uidToString() {
  String uid = "";

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      uid += "0";
    }

    uid += String(rfid.uid.uidByte[i], HEX);
  }

  uid.toUpperCase();

  return uid;
}

// =============== SCAN API ======================
bool scanUidWithServer(
  const String& uid,
  JsonDocument& result
) {
  JsonDocument request;

  request["uid"] = uid;

  String payload;
  serializeJson(request, payload);

  String response;
  int status = -1;

  if (!postJson("/api/scan", payload, response, status)) {
    if (status == 404 &&
        response.indexOf("No route for") >= 0) {
      Serial.println("[RFID] API route missing on Vercel.");
    }
    else {
      Serial.println("[RFID] Scan API request failed.");
    }

    return false;
  }

  DeserializationError error =
    deserializeJson(result, response);

  if (error) {
    Serial.print("[JSON] Parse error: ");
    Serial.println(error.c_str());
    return false;
  }

  return true;
}

// =============== RESET SESSION =================
void resetSession() {
  activeStudentId = "";
  activeStudentName = "";
  waitingForBook = false;

  Serial.println();
  Serial.println("================================");
  Serial.println("READY: SCAN STUDENT CARD FIRST");
  Serial.println("================================");
}

// =============== STUDENT VERIFICATION ==========
void handleStudent(JsonDocument& data) {
  JsonObject student = data["student"];

  if (student.isNull() || student["id"].isNull()) {
    Serial.println("[ERROR] Student details missing.");

    serializeJsonPretty(data, Serial);
    Serial.println();

    return;
  }

  activeStudentId = student["id"].as<String>();
  activeStudentName = student["name"] | "Unknown";

  waitingForBook = true;

  Serial.println();
  Serial.println("======= STUDENT VERIFIED =======");

  Serial.print("Student ID: ");
  Serial.println(activeStudentId);

  Serial.print("Student Name: ");
  Serial.println(activeStudentName);

  Serial.println("Now scan the BOOK tag.");
}

// =============== BOOK BORROW ===================
void handleBook(JsonDocument& data) {
  JsonObject book = data["book"];

  if (book.isNull() || book["id"].isNull()) {
    Serial.println("[ERROR] Book details missing.");

    serializeJsonPretty(data, Serial);
    Serial.println();

    return;
  }

  String bookId = book["id"].as<String>();
  String bookTitle = book["title"] | "Unknown title";

  bool available = data["available"] | false;

  Serial.println();
  Serial.println("========== BOOK SCANNED ==========");

  Serial.print("Book ID: ");
  Serial.println(bookId);

  Serial.print("Book Title: ");
  Serial.println(bookTitle);

  if (!available) {
    Serial.println("[BOOK] Book is unavailable or already borrowed.");

    resetSession();
    return;
  }

  JsonDocument request;

  request["studentId"] = activeStudentId;
  request["bookId"] = bookId;

  String payload;
  serializeJson(request, payload);

  String response;
  int status = -1;

  if (!postJson("/api/borrow", payload, response, status)) {
    Serial.println("[ERROR] Borrow request failed.");
    Serial.println("Fix the API and retry.");
    return;
  }

  JsonDocument result;

  DeserializationError error =
    deserializeJson(result, response);

  if (error) {
    Serial.println("[JSON] Borrow response could not be parsed.");
    resetSession();
    return;
  }

  Serial.println();
  Serial.println("======= BOOK ISSUE SUCCESS =======");

  Serial.print("Student: ");
  Serial.println(activeStudentName);

  Serial.print("Student ID: ");
  Serial.println(activeStudentId);

  Serial.print("Book: ");
  Serial.println(bookTitle);

  Serial.print("Book ID: ");
  Serial.println(bookId);

  Serial.print("Issue Date: ");
  Serial.println(result["issueDate"] | "");

  Serial.print("Due Date: ");
  Serial.println(result["dueDate"] | "");

  Serial.print("Status: ");
  Serial.println(result["status"] | "BORROWED");

  Serial.println("Borrowing record saved by backend.");
  Serial.println("Refresh your website to see the record.");

  resetSession();
}

// =============== CARD HANDLER ===================
void handleCard(const String& uid) {
  Serial.println();
  Serial.println("--------------------------------");

  Serial.print("Scanned UID: ");
  Serial.println(uid);

  Serial.println("Checking UID with backend...");

  JsonDocument data;

  if (!scanUidWithServer(uid, data)) {
    Serial.println("[SCAN FAILED] Check API and UID registration.");
    return;
  }

  String type = data["type"] | "";

  if (type == "STUDENT") {
    String scannedStudentId =
      data["student"]["id"].as<String>();

    if (waitingForBook &&
        scannedStudentId == activeStudentId) {
      Serial.println("[RFID] Student already verified.");
      Serial.println("Scan the book tag.");
    }
    else {
      if (waitingForBook) {
        Serial.println("[RFID] Switching student.");
      }

      handleStudent(data);
    }

    return;
  }

  if (type == "BOOK") {
    if (!waitingForBook || activeStudentId.isEmpty()) {
      Serial.println("[RFID] Scan student card first.");
      return;
    }

    handleBook(data);
    return;
  }

  Serial.println("[API] Unexpected response:");

  serializeJsonPretty(data, Serial);
  Serial.println();
}

// =============== WIFI CONNECTION ================
bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting");

  uint8_t attempts = 0;

  while (WiFi.status() != WL_CONNECTED &&
         attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection failed.");
    Serial.println("Check Wi-Fi name and password.");

    return false;
  }

  Serial.println("[WiFi] Connected.");

  Serial.print("[WiFi] ESP32 IP: ");
  Serial.println(WiFi.localIP());

  Serial.print("[API] Base URL: ");
  Serial.println(apiBase());

  String healthResponse;
  int healthStatus = -1;

  bool healthOk =
    getJson("/api/health", healthResponse, healthStatus);

  if (healthOk) {
    Serial.println("[API] Health endpoint reachable.");
  }
  else {
    Serial.println("[API] Health check failed.");
  }

  return true;
}

// =============== SETUP ===========================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("      RFID LIBRARY MANAGEMENT SYSTEM");
  Serial.println("==========================================");

  SPI.begin(
    RFID_SCK_PIN,
    RFID_MISO_PIN,
    RFID_MOSI_PIN,
    RFID_SS_PIN
  );

  rfid.PCD_Init();
  delay(100);

  // Temporary HTTPS testing configuration.
  // Production firmware should validate the server certificate.
  tlsClient.setInsecure();

  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);

  Serial.print("[RFID] Reader version: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("[RFID] WARNING: RC522 communication failed.");
    Serial.println("Check wiring and 3.3V power.");
  }
  else {
    Serial.println("[RFID] RC522 initialized.");
    rfid.PCD_AntennaOn();
  }

  connectWiFi();

  resetSession();
}

// =============== MAIN LOOP =======================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnect = 0;

    if (millis() - lastReconnect > 10000) {
      lastReconnect = millis();

      Serial.println("[WiFi] Reconnecting...");
      WiFi.reconnect();
    }

    delay(50);
    return;
  }

  if (!rfid.PICC_IsNewCardPresent()) {
    delay(30);
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    delay(30);
    return;
  }

  String uid = uidToString();

  unsigned long now = millis();

  if (uid == lastProcessedUID &&
      now - lastProcessedTime < SCAN_COOLDOWN_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    delay(50);
    return;
  }

  lastProcessedUID = uid;
  lastProcessedTime = now;

  Serial.println("[RFID] Card detected!");

  handleCard(uid);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(100);
}
