
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>

// ================================================
// WIFI SETTINGS
// ================================================
const char* WIFI_SSID = "Network";
const char* WIFI_PASSWORD = "11111111";

// ================================================
// YOUR NEW WEBSITE URL
// ================================================
const char* API_BASE_URL =
  "https://website-git-main-vencys-projects-01e76e39.vercel.app";

// ================================================
// RFID PINS
// ================================================
#define RFID_SS_PIN   5
#define RFID_RST_PIN  22
#define RFID_SCK_PIN  18
#define RFID_MISO_PIN 19
#define RFID_MOSI_PIN 23

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

WiFiClientSecure tlsClient;
WiFiClient plainClient;

// ================================================
// LIBRARY SETTINGS
// ================================================
const int MAX_BOOKS = 4;

enum LibraryMode {
  MODE_BORROW,
  MODE_RETURN
};

LibraryMode currentMode = MODE_BORROW;

// BOOT button
const int MODE_BUTTON_PIN = 0;
const unsigned long MODE_DEBOUNCE_MS = 220;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
unsigned long lastButtonChange = 0;

// ================================================
// SESSION DATA
// ================================================
String activeStudentId = "";
String activeStudentName = "";
String activeBorrowBatchId = "";

bool waitingForBook = false;

String lastProcessedUID = "";
unsigned long lastProcessedTime = 0;

const unsigned long SCAN_COOLDOWN_MS = 1500;

// ================================================
// API URL HELPERS
// ================================================
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

String modeName() {
  return currentMode == MODE_BORROW ? "BORROW" : "RETURN";
}

// ================================================
// HTTP INITIALIZATION
// ================================================
bool beginHttp(HTTPClient& http, const String& url) {

  http.setConnectTimeout(15000);
  http.setTimeout(20000);

  http.setFollowRedirects(
    HTTPC_STRICT_FOLLOW_REDIRECTS
  );

  if (url.startsWith("https://")) {
    return http.begin(tlsClient, url);
  }

  return http.begin(plainClient, url);
}

// ================================================
// HTTP RESPONSE
// ================================================
void printHttpResult(
  int status,
  const String& response
) {
  Serial.print("[HTTP] Status: ");
  Serial.println(status);

  if (response.length() > 0) {
    Serial.println("[HTTP] Response:");
    Serial.println(response);
  }

  if (status == 401 || status == 403) {
    Serial.println("[ERROR] Website/API requires authorization.");
  }
  else if (status == 404) {
    Serial.println("[ERROR] API route not found.");
  }
  else if (status >= 500) {
    Serial.println("[ERROR] Server error.");
  }
}

// ================================================
// POST JSON
// ================================================
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
  Serial.println("[HTTP] POST: " + url);
  Serial.println("[HTTP] Request: " + payload);

  if (!beginHttp(http, url)) {
    Serial.println("[HTTP] Initialization failed.");
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

// ================================================
// GET JSON
// ================================================
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

  HTTPClient http;

  String url = apiUrl(path);

  Serial.println("[HTTP] GET: " + url);

  if (!beginHttp(http, url)) {
    return false;
  }

  http.addHeader("Accept", "application/json");

  statusCode = http.GET();

  if (statusCode > 0) {
    responseBody = http.getString();
  }

  http.end();

  printHttpResult(statusCode, responseBody);

  return statusCode >= 200 && statusCode < 300;
}

// ================================================
// RFID UID CONVERSION
// ================================================
String uidToString() {
  String uid = "";

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10) {
      uid += "0";
    }

    uid += String(
      rfid.uid.uidByte[i],
      HEX
    );
  }

  uid.toUpperCase();

  return uid;
}

// ================================================
// RESET SESSION
// ================================================
void resetSession() {

  activeStudentId = "";
  activeStudentName = "";
  activeBorrowBatchId = "";

  waitingForBook = false;

  Serial.println();
  Serial.println("================================");

  Serial.print("CURRENT MODE: ");
  Serial.println(modeName());

  Serial.println("READY: SCAN STUDENT CARD FIRST");

  Serial.println("================================");
}

// ================================================
// MODE DISPLAY
// ================================================
void printMode() {

  Serial.println();
  Serial.println("================================");

  Serial.print("MODE: ");
  Serial.println(modeName());

  if (currentMode == MODE_BORROW) {
    Serial.println("Scan STUDENT, then BOOK to borrow.");
  } else {
    Serial.println("Scan STUDENT, then BOOK to return.");
  }

  Serial.println("BOOT button or Serial b/r switches mode.");

  Serial.println("================================");
}

// ================================================
// SWITCH MODE
// ================================================
void toggleMode() {

  currentMode =
    currentMode == MODE_BORROW
      ? MODE_RETURN
      : MODE_BORROW;

  Serial.println("[MODE] Mode changed.");

  resetSession();
}

// ================================================
// SCAN UID WITH BACKEND
// ================================================
bool scanUidWithServer(
  const String& uid,
  JsonDocument& result
) {
  JsonDocument request;

  request["uid"] = uid;
  request["action"] = modeName();

  if (!activeStudentId.isEmpty()) {
    request["studentId"] = activeStudentId;
  }

  String payload;

  serializeJson(request, payload);

  String response;
  int status = -1;

  if (!postJson(
    "/api/scan",
    payload,
    response,
    status
  )) {
    Serial.println("[SCAN] Backend request failed.");
    return false;
  }

  DeserializationError error =
    deserializeJson(result, response);

  if (error) {
    Serial.print("[JSON] Error: ");
    Serial.println(error.c_str());

    return false;
  }

  return true;
}

// ================================================
// STUDENT VERIFICATION
// ================================================
void handleStudent(JsonDocument& data) {

  JsonObject student = data["student"];

  if (
    student.isNull() ||
    student["id"].isNull()
  ) {
    Serial.println("[ERROR] Student data missing.");

    serializeJsonPretty(data, Serial);
    Serial.println();

    return;
  }

  activeStudentId =
    student["id"].as<String>();

  activeStudentName =
    student["name"] | "Unknown";

  activeBorrowBatchId =
    data["borrowBatchId"] | "";

  waitingForBook = true;

  int activeBooks =
    data["activeBooks"] | 0;

  int maxBooks =
    data["maxBooks"] | MAX_BOOKS;

  bool canBorrow =
    student["can_borrow"] | true;

  String studentStatus =
    student["status"] | "ACTIVE";

  Serial.println();
  Serial.println("======= STUDENT VERIFIED =======");

  Serial.print("Student ID: ");
  Serial.println(activeStudentId);

  Serial.print("Student Name: ");
  Serial.println(activeStudentName);

  Serial.print("Active Books: ");
  Serial.print(activeBooks);
  Serial.print(" / ");
  Serial.println(maxBooks);

  Serial.print("Remaining Capacity: ");
  Serial.println(
    max(0, maxBooks - activeBooks)
  );

  if (currentMode == MODE_BORROW) {

    if (studentStatus != "ACTIVE") {
      Serial.println("[ERROR] Student is inactive.");

      waitingForBook = false;
      return;
    }

    if (!canBorrow || activeBooks >= MAX_BOOKS) {
      Serial.println("[ERROR] Borrowing limit reached.");

      Serial.println("Return a book before borrowing another.");

      waitingForBook = false;
      return;
    }
  }

  if (!activeBorrowBatchId.isEmpty()) {
    Serial.print("Borrow Batch: ");
    Serial.println(activeBorrowBatchId);
  }

  Serial.println();

  if (currentMode == MODE_BORROW) {
    Serial.println("Now scan the BOOK tag to BORROW.");
  } else {
    Serial.println("Now scan the BOOK tag to RETURN.");
  }
}

// ================================================
// BORROW BOOK
// ================================================
void handleBorrowBook(JsonDocument& data) {

  JsonObject book = data["book"];

  if (
    book.isNull() ||
    book["id"].isNull()
  ) {
    Serial.println("[ERROR] Book details missing.");

    serializeJsonPretty(data, Serial);
    Serial.println();

    return;
  }

  String bookId =
    book["id"].as<String>();

  String bookTitle =
    book["title"] | "Unknown title";

  bool available =
    data["available"] | false;

  Serial.println();
  Serial.println("========== BOOK SCANNED ==========");

  Serial.print("Book ID: ");
  Serial.println(bookId);

  Serial.print("Book Title: ");
  Serial.println(bookTitle);

  if (!available) {
    Serial.println("[ERROR] Book is unavailable.");
    return;
  }

  JsonDocument request;

  request["studentId"] = activeStudentId;
  request["bookId"] = bookId;
  request["rfidUid"] = book["uid"] | "";

  if (!activeBorrowBatchId.isEmpty()) {
    request["borrowBatchId"] = activeBorrowBatchId;
  }

  String payload;

  serializeJson(request, payload);

  String response;
  int status = -1;

  if (!postJson(
    "/api/borrow",
    payload,
    response,
    status
  )) {
    Serial.println("[ERROR] Borrow failed.");

    Serial.println("Check backend response before retrying.");

    return;
  }

  JsonDocument result;

  DeserializationError error =
    deserializeJson(result, response);

  if (error) {
    Serial.println("[JSON] Invalid borrow response.");

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

  Serial.print("Borrow Batch: ");
  Serial.println(
    result["borrowBatchId"] | ""
  );

  Serial.print("Issue Date: ");
  Serial.println(
    result["issueDate"] | ""
  );

  Serial.print("Due Date: ");
  Serial.println(
    result["dueDate"] | ""
  );

  Serial.print("Active Books: ");
  Serial.print(result["activeBooks"] | 0);
  Serial.print(" / ");
  Serial.println(result["maxBooks"] | MAX_BOOKS);

  Serial.print("Status: ");
  Serial.println(result["status"] | "BORROWED");

  Serial.println("[SUCCESS] Borrow record saved.");

  resetSession();
}

// ================================================
// RETURN BOOK
// ================================================
void handleReturnBook(JsonDocument& data) {

  JsonObject book = data["book"];

  if (
    book.isNull() ||
    book["id"].isNull()
  ) {
    Serial.println("[ERROR] Book details missing.");

    serializeJsonPretty(data, Serial);
    Serial.println();

    return;
  }

  String bookId =
    book["id"].as<String>();

  String bookTitle =
    book["title"] | "Unknown title";

  JsonObject activeBorrowing =
    data["activeBorrowing"];

  Serial.println();
  Serial.println("========== BOOK SCANNED ==========");

  Serial.print("Book ID: ");
  Serial.println(bookId);

  Serial.print("Book Title: ");
  Serial.println(bookTitle);

  if (
    activeBorrowing.isNull() ||
    activeBorrowing["id"].isNull()
  ) {
    Serial.println("[ERROR] No active borrowing record.");
    return;
  }

  String borrowerId =
    activeBorrowing["studentId"] | "";

  if (
    !borrowerId.isEmpty() &&
    borrowerId != activeStudentId
  ) {
    Serial.println("[ERROR] Book belongs to another student.");
    return;
  }

  JsonDocument request;

  request["studentId"] = activeStudentId;
  request["bookId"] = bookId;

  request["borrowingId"] =
    activeBorrowing["id"];

  request["rfidUid"] =
    book["uid"] | "";

  String payload;

  serializeJson(request, payload);

  String response;
  int status = -1;

  if (!postJson(
    "/api/return",
    payload,
    response,
    status
  )) {
    Serial.println("[ERROR] Return request failed.");
    return;
  }

  JsonDocument result;

  DeserializationError error =
    deserializeJson(result, response);

  if (error) {
    Serial.println("[JSON] Invalid return response.");

    resetSession();
    return;
  }

  Serial.println();
  Serial.println("======= BOOK RETURN SUCCESS ======");

  Serial.print("Student: ");
  Serial.println(activeStudentName);

  Serial.print("Student ID: ");
  Serial.println(activeStudentId);

  Serial.print("Book: ");
  Serial.println(bookTitle);

  Serial.print("Book ID: ");
  Serial.println(bookId);

  Serial.print("Return Date: ");
  Serial.println(
    result["returnDate"] | ""
  );

  Serial.print("Status: ");
  Serial.println(
    result["status"] | "RETURNED"
  );

  Serial.println("[SUCCESS] Borrowing record updated.");

  resetSession();
}

// ================================================
// BOOK HANDLER
// ================================================
void handleBook(JsonDocument& data) {

  if (currentMode == MODE_RETURN) {
    handleReturnBook(data);
  } else {
    handleBorrowBook(data);
  }
}

// ================================================
// CARD HANDLER
// ================================================
void handleCard(const String& uid) {

  Serial.println();
  Serial.println("--------------------------------");

  Serial.print("Scanned UID: ");
  Serial.println(uid);

  Serial.println("Checking UID with backend...");

  JsonDocument data;

  if (!scanUidWithServer(uid, data)) {
    Serial.println("[SCAN FAILED] Check API and UID.");
    return;
  }

  String type = data["type"] | "";

  if (type == "STUDENT") {

    String scannedStudentId =
      data["student"]["id"].as<String>();

    if (
      waitingForBook &&
      scannedStudentId == activeStudentId
    ) {
      Serial.println("[RFID] Student already verified.");
      Serial.println("Scan the book tag.");
    } else {
      if (waitingForBook) {
        Serial.println("[RFID] Switching student.");
      }

      handleStudent(data);
    }

    return;
  }

  if (type == "BOOK") {

    if (
      !waitingForBook ||
      activeStudentId.isEmpty()
    ) {
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

// ================================================
// WIFI CONNECTION
// ================================================
bool connectWiFi() {

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting");

  int attempts = 0;

  while (
    WiFi.status() != WL_CONNECTED &&
    attempts < 40
  ) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection failed.");
    return false;
  }

  Serial.println("[WiFi] Connected.");

  Serial.print("[WiFi] ESP32 IP: ");
  Serial.println(WiFi.localIP());

  Serial.print("[API] Website: ");
  Serial.println(apiBase());

  String healthResponse;
  int healthStatus = -1;

  bool healthOk = getJson(
    "/api/health",
    healthResponse,
    healthStatus
  );

  if (healthOk) {
    Serial.println("[API] Health endpoint reachable.");
  } else {
    Serial.println("[API] Health check failed.");
    Serial.println("Verify /api/health exists on Vercel.");
  }

  return true;
}

// ================================================
// MODE CONTROLS
// ================================================
void pollModeControls() {

  bool reading =
    digitalRead(MODE_BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonChange = millis();
    lastButtonReading = reading;
  }

  if (
    millis() - lastButtonChange > MODE_DEBOUNCE_MS &&
    reading != stableButtonState
  ) {
    stableButtonState = reading;

    if (stableButtonState == LOW) {
      toggleMode();
    }
  }

  while (Serial.available() > 0) {

    char command = Serial.read();

    if (command == 'b' || command == 'B') {
      currentMode = MODE_BORROW;
      resetSession();
    }

    else if (command == 'r' || command == 'R') {
      currentMode = MODE_RETURN;
      resetSession();
    }

    else if (command == 's' || command == 'S') {
      printMode();
    }
  }
}

// ================================================
// SETUP
// ================================================
void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("     SMART RFID LIBRARY MANAGEMENT");
  Serial.println("==========================================");

  // Initialize SPI
  SPI.begin(
    RFID_SCK_PIN,
    RFID_MISO_PIN,
    RFID_MOSI_PIN,
    RFID_SS_PIN
  );

  // Initialize button
  pinMode(MODE_BUTTON_PIN, INPUT_PULLUP);

  lastButtonReading =
    digitalRead(MODE_BUTTON_PIN);

  stableButtonState = lastButtonReading;

  // Initialize RFID
  rfid.PCD_Init();
  delay(100);

  // Temporary testing configuration.
  // For production, validate the server certificate.
  tlsClient.setInsecure();

  byte version =
    rfid.PCD_ReadRegister(rfid.VersionReg);

  Serial.print("[RFID] Reader version: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {

    Serial.println("[RFID] RC522 communication failed.");
    Serial.println("Check wiring and 3.3V power.");

  } else {

    Serial.println("[RFID] RC522 initialized.");
    rfid.PCD_AntennaOn();
  }

  // Connect WiFi
  connectWiFi();

  // Ready
  resetSession();
}

// ================================================
// MAIN LOOP
// ================================================
void loop() {

  pollModeControls();

  // Reconnect WiFi if disconnected
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

  // Check new RFID card
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

  // Prevent repeated scans
  if (
    uid == lastProcessedUID &&
    now - lastProcessedTime < SCAN_COOLDOWN_MS
  ) {
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
