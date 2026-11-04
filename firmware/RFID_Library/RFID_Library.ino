
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// =====================================
// 1. WIFI CONFIGURATION
// =====================================

const char* WIFI_SSID = "Network";
const char* WIFI_PASSWORD = "11111111";

// Use a PUBLIC Vercel deployment URL.
// Do not use a deployment protected by Vercel Authentication.
const char* SERVER_URL =
  "https://website-git-main-vencys-projects-01e76e39.vercel.app";

// =====================================
// 2. RFID PIN CONFIGURATION
// =====================================

// Shared SPI pins
#define SPI_SCK  18
#define SPI_MISO 19
#define SPI_MOSI 23

// ENTRY reader: Borrow
#define ENTRY_SS  5
#define ENTRY_RST 22

// RETURN reader: Return
#define RETURN_SS  21
#define RETURN_RST 27

// Shared new-student button
#define BUTTON_PIN 32

// =====================================
// 3. RFID OBJECTS
// =====================================

MFRC522 entryReader(ENTRY_SS, ENTRY_RST);
MFRC522 returnReader(RETURN_SS, RETURN_RST);

// =====================================
// 4. STUDENT SESSION
// =====================================

struct StudentSession {
  bool active = false;
  String studentId = "";
  String studentName = "";
  String lastUID = "";
  unsigned long lastScanTime = 0;
};

StudentSession entrySession;
StudentSession returnSession;

bool lastButtonState = HIGH;
unsigned long lastButtonTime = 0;

const unsigned long BUTTON_DEBOUNCE = 250;
const unsigned long RFID_COOLDOWN = 1500;

// =====================================
// 5. HELPER FUNCTIONS
// =====================================

String getUID(MFRC522 &reader) {
  String uid = "";

  for (byte i = 0; i < reader.uid.size; i++) {
    if (reader.uid.uidByte[i] < 0x10) {
      uid += "0";
    }

    uid += String(reader.uid.uidByte[i], HEX);
  }

  uid.toUpperCase();
  return uid;
}

String jsonValueToString(JsonVariant value) {
  if (value.is<const char*>()) {
    return String(value.as<const char*>());
  }

  if (value.is<long>()) {
    return String(value.as<long>());
  }

  if (value.is<int>()) {
    return String(value.as<int>());
  }

  return "";
}

void finishCard(MFRC522 &reader) {
  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
}

// =====================================
// 6. WIFI CONNECTION
// =====================================

void connectWiFi() {
  Serial.println();
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected!");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed!");
  }
}

// =====================================
// 7. SEND JSON TO WEBSITE
// =====================================

bool postToServer(
  const char* endpoint,
  JsonDocument &request,
  JsonDocument &response
) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected!");
    return false;
  }

  WiFiClientSecure client;

  // Testing only. For production, verify the server certificate.
  client.setInsecure();

  HTTPClient http;

  String url = String(SERVER_URL) + endpoint;

  Serial.print("POST: ");
  Serial.println(url);

  if (!http.begin(client, url)) {
    Serial.println("HTTP connection failed!");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  String requestBody;
  serializeJson(request, requestBody);

  Serial.print("Request: ");
  Serial.println(requestBody);

  int httpCode = http.POST(requestBody);

  Serial.print("HTTP Status: ");
  Serial.println(httpCode);

  String responseBody = http.getString();

  Serial.print("Response: ");
  Serial.println(responseBody);

  http.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.println("Server request failed!");
    return false;
  }

  DeserializationError error =
    deserializeJson(response, responseBody);

  if (error) {
    Serial.print("JSON parsing failed: ");
    Serial.println(error.c_str());
    return false;
  }

  return true;
}

// =====================================
// 8. SCAN STUDENT CARD
// =====================================

bool scanStudent(
  String uid,
  const char* action,
  StudentSession &session
) {
  JsonDocument request;
  JsonDocument response;

  request["uid"] = uid;
  request["action"] = action;

  if (!postToServer("/api/scan", request, response)) {
    return false;
  }

  String type = response["type"] | "";

  if (type != "STUDENT") {
    Serial.println("This card is not registered as a student!");
    return false;
  }

  String studentId =
    jsonValueToString(response["student"]["id"]);

  String studentName =
    response["student"]["name"] | "";

  if (studentId.length() == 0) {
    Serial.println("Student ID missing in server response!");
    return false;
  }

  session.active = true;
  session.studentId = studentId;
  session.studentName = studentName;

  Serial.println();
  Serial.println("STUDENT VERIFIED SUCCESSFULLY");
  Serial.print("Student ID: ");
  Serial.println(session.studentId);
  Serial.print("Student Name: ");
  Serial.println(session.studentName);

  Serial.println("Now scan book RFID tags.");
  return true;
}

// =====================================
// 9. SCAN BOOK CARD
// =====================================

void scanBook(
  String uid,
  const char* action,
  StudentSession &session
) {
  JsonDocument request;
  JsonDocument response;

  request["uid"] = uid;
  request["action"] = action;
  request["studentId"] = session.studentId;

  if (!postToServer("/api/scan", request, response)) {
    return;
  }

  String type = response["type"] | "";

  if (type != "BOOK") {
    Serial.println("This RFID is not registered as a book!");
    return;
  }

  String bookId =
    jsonValueToString(response["book"]["id"]);

  String bookTitle =
    response["book"]["title"] | "";

  if (bookId.length() == 0) {
    Serial.println("Book ID missing!");
    return;
  }

  Serial.println();
  Serial.print("Book found: ");
  Serial.println(bookTitle);
  Serial.print("Book ID: ");
  Serial.println(bookId);

  // =================================
  // BORROW BOOK
  // =================================

  if (String(action) == "BORROW") {

    bool available = response["available"] | false;

    if (!available) {
      Serial.println("Book is not available for borrowing!");
      return;
    }

    JsonDocument borrowRequest;
    JsonDocument borrowResponse;

    borrowRequest["studentId"] = session.studentId;
    borrowRequest["bookId"] = bookId;
    borrowRequest["rfidUid"] = uid;

    String batchId =
      jsonValueToString(response["borrowBatchId"]);

    if (batchId.length() > 0) {
      borrowRequest["borrowBatchId"] = batchId;
    }

    if (!postToServer(
      "/api/borrow",
      borrowRequest,
      borrowResponse
    )) {
      return;
    }

    Serial.println();
    Serial.println("BOOK BORROWED SUCCESSFULLY!");

    Serial.print("Issue Date: ");
    Serial.println(
      borrowResponse["issueDate"] | "Not provided"
    );

    Serial.print("Due Date: ");
    Serial.println(
      borrowResponse["dueDate"] | "Not provided"
    );
  }

  // =================================
  // RETURN BOOK
  // =================================

  else if (String(action) == "RETURN") {

    String borrowingId =
      jsonValueToString(response["activeBorrowing"]["id"]);

    if (borrowingId.length() == 0) {
      Serial.println("No active borrowing record found!");
      return;
    }

    JsonDocument returnRequest;
    JsonDocument returnResponse;

    returnRequest["studentId"] = session.studentId;
    returnRequest["bookId"] = bookId;
    returnRequest["borrowingId"] = borrowingId;
    returnRequest["rfidUid"] = uid;

    if (!postToServer(
      "/api/return",
      returnRequest,
      returnResponse
    )) {
      return;
    }

    Serial.println();
    Serial.println("BOOK RETURNED SUCCESSFULLY!");

    Serial.print("Return Date: ");
    Serial.println(
      returnResponse["returnDate"] | "Not provided"
    );
  }
}

// =====================================
// 10. HANDLE ENTRY READER
// =====================================

void handleEntryReader() {

  if (!entryReader.PICC_IsNewCardPresent()) return;
  if (!entryReader.PICC_ReadCardSerial()) return;

  String uid = getUID(entryReader);

  if (uid == entrySession.lastUID &&
      millis() - entrySession.lastScanTime < RFID_COOLDOWN) {
    finishCard(entryReader);
    return;
  }

  entrySession.lastUID = uid;
  entrySession.lastScanTime = millis();

  Serial.println();
  Serial.println("========== ENTRY READER ==========");
  Serial.print("Scanned UID: ");
  Serial.println(uid);

  if (!entrySession.active) {
    scanStudent(uid, "BORROW", entrySession);
  } else {
    scanBook(uid, "BORROW", entrySession);
  }

  finishCard(entryReader);
}

// =====================================
// 11. HANDLE RETURN READER
// =====================================

void handleReturnReader() {

  if (!returnReader.PICC_IsNewCardPresent()) return;
  if (!returnReader.PICC_ReadCardSerial()) return;

  String uid = getUID(returnReader);

  if (uid == returnSession.lastUID &&
      millis() - returnSession.lastScanTime < RFID_COOLDOWN) {
    finishCard(returnReader);
    return;
  }

  returnSession.lastUID = uid;
  returnSession.lastScanTime = millis();

  Serial.println();
  Serial.println("========== RETURN READER ==========");
  Serial.print("Scanned UID: ");
  Serial.println(uid);

  if (!returnSession.active) {
    scanStudent(uid, "RETURN", returnSession);
  } else {
    scanBook(uid, "RETURN", returnSession);
  }

  finishCard(returnReader);
}

// =====================================
// 12. SHARED NEW-STUDENT BUTTON
// =====================================

void handleButton() {

  bool buttonState = digitalRead(BUTTON_PIN);

  if (lastButtonState == HIGH && buttonState == LOW) {

    if (millis() - lastButtonTime > BUTTON_DEBOUNCE) {

      lastButtonTime = millis();

      entrySession.active = false;
      entrySession.studentId = "";
      entrySession.studentName = "";
      entrySession.lastUID = "";

      returnSession.active = false;
      returnSession.studentId = "";
      returnSession.studentName = "";
      returnSession.lastUID = "";

      Serial.println();
      Serial.println("================================");
      Serial.println("NEW STUDENT SESSION STARTED");
      Serial.println("Both readers are ready.");
      Serial.println("Scan a student ID first.");
      Serial.println("================================");
    }
  }

  lastButtonState = buttonState;
}

// =====================================
// 13. SETUP
// =====================================

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("SMART RFID LIBRARY SYSTEM");
  Serial.println("Two Reader Configuration");

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Shared SPI bus
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI);

  // Initialize ENTRY reader
  pinMode(ENTRY_SS, OUTPUT);
  pinMode(RETURN_SS, OUTPUT);

  digitalWrite(ENTRY_SS, HIGH);
  digitalWrite(RETURN_SS, HIGH);

  entryReader.PCD_Init();
  delay(50);

  // Initialize RETURN reader
  returnReader.PCD_Init();
  delay(50);

  Serial.println("ENTRY RC522 initialized.");
  Serial.println("RETURN RC522 initialized.");

  connectWiFi();

  Serial.println();
  Serial.println("SYSTEM READY");
  Serial.println("ENTRY reader: Borrow books");
  Serial.println("RETURN reader: Return books");
  Serial.println("Button: Select next student");
}

// =====================================
// 14. MAIN LOOP
// =====================================

void loop() {

  handleButton();

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Check both readers continuously
  handleEntryReader();
  handleReturnReader();

  delay(10);
}
