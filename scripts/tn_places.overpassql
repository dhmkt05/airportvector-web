[out:json][timeout:300];
area["ISO3166-2"="IN-TN"]->.tn;
node["place"~"^(town|suburb|village|hamlet|neighbourhood|quarter|locality|isolated_dwelling)$"](area.tn);
out body;
