#include <WiFi.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char* VEHICLE_ID = "ESP32-VH-01";

String mqttTopic = String("vehicle/") + VEHICLE_ID + "/location";
String mqttStatusTopic = String("vehicle/") + VEHICLE_ID + "/status";
String mqttCommandTopic = String("vehicle/") + VEHICLE_ID + "/command";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

unsigned long lastPublishAt = 0;
float latitude = 28.6139;
float longitude = 77.2090;
int speedKmh = 0;
bool engineOn = true;
bool locked = true;
int gsmSignal = 4;

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String topicText = String(topic);
  String body;
  body.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    body += (char)payload[i];
  }
  body.toUpperCase();

  if (topicText != mqttCommandTopic) {
    return;
  }

  if (body.indexOf("START_ENGINE") >= 0) {
    engineOn = true;
  } else if (body.indexOf("STOP_ENGINE") >= 0) {
    engineOn = false;
    speedKmh = 0;
  } else if (body.indexOf("UNLOCK") >= 0) {
    locked = false;
  } else if (body.indexOf("LOCK") >= 0) {
    locked = true;
  }
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void connectMQTT() {
  while (!mqttClient.connected()) {
    String clientId = String("esp32-") + VEHICLE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqttClient.connect(clientId.c_str(), mqttStatusTopic.c_str(), 1, true, "offline")) {
      mqttClient.subscribe(mqttCommandTopic.c_str(), 1);
      mqttClient.publish(mqttStatusTopic.c_str(), "online", true);
      break;
    }
    delay(2000);
  }
}

void publishLocation() {
  latitude += ((random(-5, 6)) * 0.0001f);
  longitude += ((random(-5, 6)) * 0.0001f);
  speedKmh = engineOn ? constrain(speedKmh + random(-6, 7), 0, 90) : 0;
  gsmSignal = constrain(gsmSignal + random(-1, 2), 0, 5);

  char payload[256];
  snprintf(
    payload,
    sizeof(payload),
    "{\"vehicleId\":\"%s\",\"latitude\":%.6f,\"longitude\":%.6f,\"speed\":%d,\"gsmSignal\":%d,\"engineOn\":%s,\"locked\":%s,\"timestamp\":%lu}",
    VEHICLE_ID,
    latitude,
    longitude,
    speedKmh,
    gsmSignal,
    engineOn ? "true" : "false",
    locked ? "true" : "false",
    millis()
  );

  mqttClient.publish(mqttTopic.c_str(), payload);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  randomSeed(esp_random());
  connectWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setKeepAlive(5);
}

void loop() {
  connectWiFi();

  if (!mqttClient.connected()) {
    connectMQTT();
  }

  mqttClient.loop();

  if (millis() - lastPublishAt >= 2000) {
    lastPublishAt = millis();
    publishLocation();
  }
}