
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>

// ================ WIFI SETTINGS ================
const char* WIFI_SSID = "Network";
const char* WIFI_PASSWORD = "11111111";

// ================ API SETTINGS =================
// Your DEPLOYED website URL (no trailing slash).
// Vercel example: "https://rfid-library.vercel.app"
// For local testing you may use "http://10.236.200.250:3000".
const char* API_BASE_URL = "https://your-app.vercel.app";

// ================ RFID PINS ====================
constexpr uint8_t RFID_SS_PIN   = 5;
constexpr uint8_t RFID_RST_PIN  = 22;
constexpr uint8_t RFID_SCK_PIN  = 18;
constexpr uint8_t RFID_MISO_PIN = 19;
constexpr uint8_t RFID_MOSI_PIN = 23;

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

// ================ SESSION ======================
String activeStudentId = "";
String activeStudentName = "";
bool waitingForBook = false;

// Prevent repeated processing of a card held on the reader
String lastProcessedUID = "";
unsigned long lastProcessedTime = 0;
const unsigned long SCAN_COOLDOWN = 1200;

// ================ API URL ======================
// Vercel serves over HTTPS; a plain WiFiClient is used only for http:// URLs.
WiFiClientSecure tlsClient;
WiFiClient plainClient;

bool apiUsesTls() {
  return String(API_BASE_URL).startsWith("https://");
}

String apiUrl(const String& path) {
  return String(API_BASE_URL) + path;
}

bool apiBegin(HTTPClient& http, const String& url) {
  if (apiUsesTls()) {
    return http.begin(tlsClient, url);
  }
  return http.begin(plainClient, url);
}

// ================ UID CONVERSION ===============
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

// ================ HTTP POST ====================
bool postJson(
  const String& path,
  const String& payload,
  String& responseBody,
  int& statusCode
) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Not connected.");
    responseBody = "";
    statusCode = -1;
    return false;
  }

  HTTPClient http;
  String url = apiUrl(path);

  http.setConnectTimeout(5000);
  http.setTimeout(8000);

  Serial.println("[HTTP] POST " + url);

  if (!apiBegin(http, url)) {
    Serial.println("[HTTP] Initialization failed.");
    responseBody = "";
    statusCode = -1;
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  statusCode = http.POST(payload);

  if (statusCode > 0) {
    responseBody = http.getString();
  } else {
    responseBody = "";
    Serial.print("[HTTP] Request failed: ");
    Serial.println(http.errorToString(statusCode));
  }

  http.end();

  Serial.print("[HTTP] Status: ");
  Serial.println(statusCode);

  if (responseBody.length() > 0) {
    Serial.println("[HTTP] Response:");
    Serial.println(responseBody);
  }

  return statusCode >= 200 && statusCode < 300;
}

// ================ SCAN API =====================
bool scanUidWithServer(
  const String& uid,
  JsonDocument& result
) {
  JsonDocument request;
  request["uid"] = uid;

  String payload;
  serializeJson(request, payload);

  String response;
  int status = 0;

  if (!postJson("/api/scan", payload, response, status)) {
    if (status == 404) {
      Serial.println("[RFID] UID not registered.");
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

// ================ RESET SESSION ================
void resetSession() {
  activeStudentId = "";
  activeStudentName = "";
  waitingForBook = false;

  Serial.println();
  Serial.println("================================");
  Serial.println("Ready: scan STUDENT card first.");
  Serial.println("================================");
}

// ================ STUDENT SCAN =================
void handleStudent(JsonDocument& data) {
  JsonObject student = data["student"];

  if (student.isNull() || student["id"].isNull()) {
    Serial.println("[ERROR] Student ID missing in API response.");
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

// ================ BOOK BORROW ==================
void handleBook(JsonDocument& data) {
  JsonObject book = data["book"];

  if (book.isNull() || book["id"].isNull()) {
    Serial.println("[ERROR] Book ID missing in API response.");
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
    Serial.println("Book unavailable or already borrowed.");
    resetSession();
    return;
  }

  JsonDocument request;
  request["studentId"] = activeStudentId;
  request["bookId"] = bookId;

  String payload;
  serializeJson(request, payload);

  String response;
  int status = 0;

  bool success = postJson(
    "/api/borrow",
    payload,
    response,
    status
  );

  if (!success) {
    Serial.println("[ERROR] Borrowing request failed.");
    Serial.println("Check the deployed URL, the /api/health endpoint and Appwrite.");
    return;
  }

  JsonDocument result;
  DeserializationError error =
    deserializeJson(result, response);

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

  if (!error) {
    Serial.print("Issue Date: ");
    Serial.println(result["issueDate"] | "");

    Serial.print("Due Date: ");
    Serial.println(result["dueDate"] | "");

    Serial.print("Status: ");
    Serial.println(result["status"] | "BORROWED");
  }

  Serial.println("Borrowing entry saved by the backend.");
  Serial.println("Refresh the website to see the record.");

  resetSession();
}

// ================ HANDLE RFID ==================
void handleCard(const String& uid) {
  Serial.println();
  Serial.println("--------------------------------");
  Serial.print("Scanned UID: ");
  Serial.println(uid);
  Serial.println("Checking UID with backend...");

  JsonDocument data;

  if (!scanUidWithServer(uid, data)) {
    Serial.println(
      "Scan failed. Check Wi-Fi, server and UID registration."
    );
    return;
  }

  String type = data["type"] | "";

  if (type == "STUDENT") {
    if (waitingForBook) {
      String scannedStudentId =
        data["student"]["id"].as<String>();

      if (scannedStudentId == activeStudentId) {
        Serial.println(
          "Student already verified. Scan the book."
        );
      } else {
        Serial.println("Switching to the newly scanned student.");
        handleStudent(data);
      }
    } else {
      handleStudent(data);
    }

    return;
  }

  if (type == "BOOK") {
    if (!waitingForBook || activeStudentId.length() == 0) {
      Serial.println("Scan a student card before scanning a book.");
      return;
    }

    handleBook(data);
    return;
  }

  Serial.println("Unexpected response from the server.");
  serializeJson(data, Serial);
  Serial.println();
}

// ================ WIFI CONNECT =================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  uint8_t attempts = 0;

  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection failed. Check credentials.");
    return;
  }

  Serial.println("[WiFi] Connected.");

  Serial.print("[WiFi] ESP32 IP: ");
  Serial.println(WiFi.localIP());

  Serial.print("[API] Server URL: ");
  Serial.println(API_BASE_URL);

  HTTPClient http;
  String url = apiUrl("/api/health");

  http.setConnectTimeout(5000);
  http.setTimeout(8000);

  if (apiBegin(http, url)) {
    int status = http.GET();

    Serial.print("[API] Health status: ");
    Serial.println(status);

    if (status > 0) {
      Serial.println(http.getString());
    } else {
      Serial.println("Cannot reach backend. Check the deployed URL.");
    }

    http.end();
  }
}

// ================ SETUP ========================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("     RFID LIBRARY MANAGEMENT SYSTEM");
  Serial.println("==========================================");

  SPI.begin(
    RFID_SCK_PIN,
    RFID_MISO_PIN,
    RFID_MOSI_PIN,
    RFID_SS_PIN
  );

  rfid.PCD_Init();
  delay(100);

  // Vercel uses a valid TLS certificate, but we skip pinning so the
  // sketch works across Appwrite/Vercel certificate rotations.
  tlsClient.setInsecure();

  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);

  Serial.print("[RFID] Reader version: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("[RFID] WARNING: Check reader wiring.");
  } else {
    Serial.println("[RFID] RC522 initialized.");
    rfid.PCD_AntennaOn();
  }

  connectWiFi();
  resetSession();
}

// ================ MAIN LOOP ====================
void loop() {
  // Reconnect Wi-Fi without requiring an ESP32 reset
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

  // Keep polling the reader continuously
  if (!rfid.PICC_IsNewCardPresent()) {
    delay(30);
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    delay(30);
    return;
  }

  String uid = uidToString();

  // Ignore rapid duplicate reads of the same card
  unsigned long now = millis();

  if (uid == lastProcessedUID &&
      now - lastProcessedTime < SCAN_COOLDOWN) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    delay(50);
    return;
  }

  lastProcessedUID = uid;
  lastProcessedTime = now;

  Serial.println("[RFID] Card detected!");
  handleCard(uid);

  // End communication with the current card
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Do not reset or reinitialize the ESP32 here
  delay(100);
}
