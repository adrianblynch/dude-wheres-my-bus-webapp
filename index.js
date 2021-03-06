$(function () {

	var stopCodeInput = $("input[name='stopCode']")
	var busesInput = $("input[name='buses']")
	var alertMinutesInput = $("input[name='alertMinutes']")
	var startBtn = $("button[name='start']")
	var stopBtn = $("button[name='stop']")
	var centreOnLocationBtn = $("#centreOnLocation")
	var expectedBusesTextarea = $("textarea[name='expectedBuses']")
	var alertTypesInputs = $("input[name='alertTypes']")
	var getTimesInterval
	var previousAlerts = {}
	var LONDON = {lat: 51.489309500000005, lng: -0.08818969999999995}
	var HOME = {lat: 51.396369, lng: 0.0308211}
	var GET_TIMES_MS = 10000
	var START_ZOOM = 16
	var BUS_STOPS_URL = window.location.href.indexOf("localhost") === -1 ? "https://thawing-plains-9018.herokuapp.com/stops" : "http://localhost:3000/stops"

	var stopMap = $("#stopMap")

	startBtn.click(function (e) {
		e.preventDefault()

		var stopCode = stopCodeInput.val()
		var buses = busesInput.val()
		var alertMinutes = alertMinutesInput.val()

		clearInterval(getTimesInterval)

		start(stopCode, buses, alertMinutes)

		getTimesInterval = setInterval(function () {
			start(stopCode, buses, alertMinutes)
		}, GET_TIMES_MS)
	})

	stopBtn.click(function (e) {
		e.preventDefault()
		expectedBusesTextarea.val("")
		clearInterval(getTimesInterval)
	})

	centreOnLocationBtn.click(function(e) {
		var originalValue = e.currentTarget.innerText
		e.currentTarget.innerText = "Please wait..."
		e.currentTarget.disabled = true
		e.preventDefault()
		getCurrentPosition()
		.then(function(response) {
			return centreMapOn(map, {latitude: response.coords.latitude, longitude: response.coords.longitude})
		})
		.then(function() {
			e.currentTarget.innerText = originalValue
			e.currentTarget.disabled = false
		})
	})

	function start(stop, buses, alertMinutes) {

		var tflApiUrl = "http://countdown.api.tfl.gov.uk/interfaces/ura/instant_V1?StopAlso=false&StopID=" + stop + "&LineName=" + buses + "&ReturnList=LineName,EstimatedTime,MessageType,MessageText,ExpireTime,VehicleID"
		var xhr = $.ajax(tflApiUrl, {method: "get", dataType: "text"})

		xhr.done(function (response) {
			var expectedBuses = getExpectedBuses(filterByBus(deserialiseResponse(response), buses))
			showExpectedBuses(expectedBuses)
			alertExpectedBuses(expectedBuses, alertMinutes)
		})
		xhr.fail(function () {
			console.log("Failed calling TfL's API")
		})

	}

	function alertExpectedBuses(expectedBuses, alertMinutes) {

		alertMinutes = Array.isArray(alertMinutes) ? alertMinutes : alertMinutes.split(",")

		expectedBuses.forEach(function (expectedBus) {

			var index = alertMinutes.indexOf(expectedBus.expected.toString())

			if (index !== -1) {

				var key = expectedBus.vehicleId + "_" + expectedBus.bus + "_" + expectedBus.expected
				var previousAlert = previousAlerts[key]

				if (!previousAlert) {
					alertBus(expectedBus.bus, alertMinutes[index])
					previousAlerts[key] = true
				}
			}

		})

	}

	// if ('speechSynthesis' in window) { // Audio available }
	// if ("Notification" in window) { // Notifications available }

	function alertBus(bus, minutes) {

		function message(bus, minutes) {
			var message = "The " + bus + " is due"
			if (minutes != 0) {
				message +=  " in " + minutes + " minute" + (minutes > 1 ? "s" : "")
			}
			return message
		}

		var alertType = alertTypesInputs.filter(":checked").val()

		if (alertType === "spokenAudio") {

			bus = bus.split("").join(" ") // Sounds better with number split

			var utterance = new SpeechSynthesisUtterance(message(bus, minutes))
			window.speechSynthesis.speak(utterance)

		} else if (alertType === "desktopNotification") {

			Notification.requestPermission(function (permission) {
				if (permission === "granted") {
					var notification = new Notification(message(bus, minutes), {tag: bus})
					notification.onshow = function () {
						setTimeout(notification.close.bind(notification), 5000)
					}
				}
			})

		} else {

			console.log(message(bus, minutes))

		}

	}

	function showExpectedBuses(expectedBuses) {
		var messages = []
		expectedBuses.forEach(function (expectedBus) {
			messages.push("The " + expectedBus.bus + " is expected in " + expectedBus.expected + " minute(s)")

		})
		expectedBusesTextarea.val(messages.join("\n"))
	}

	function getExpectedBuses(data) {
		var now = new Date()
		return data.map(function (row) {
			return {
				vehicleId: row[2],
				bus: row[1],
				expected: getTimeDifference(now, row[3], "m")
			}
		})
	}

	function getTimeDifference(from, to, unit) {
		var ms = to - from
		var differences = {
			ms: ms,
			s: Math.abs(ms) / 1000,
			m: Math.floor(ms / 1000 / 60) % 60
		}
		return differences[unit]
	}

	function filterByBus(data, buses) {
		buses = Array.isArray(buses) ? buses : buses.split(",")
		return data.filter(function (row) {
			return buses.indexOf(row[1]) !== -1
		})
	}

	function deserialiseResponse(response, bus) {
		return response.split("\n").map(function (row) {
			return JSON.parse(row)
		})
	}

	// Stops map

	var map, stops, markers, currentPosition

	getBusStops()
	.then(function(response) {
		stops = response.length ? response : [response]
		return initialiseMap(stops)
	})
	.then(function(response) {
		map = response
		return makeStopMarkers(stops, map)
	})
	.then(function(response) {
		markers = response
		return getCurrentPosition()
	})
	.then(function(response) {
		return centreMapOn(map, {latitude: response.coords.latitude, longitude: response.coords.longitude})
	})
	.catch(function(e) {
		console.log("An error occurred doing something!", e)
	})

	function getBusStops() {
		return new Promise(function(resolve, reject) {
			$.get(BUS_STOPS_URL).done(resolve).fail(reject)
		})
	}

	function initialiseMap(stops) {
		return new Promise(function(resolve, reject) {
			try {
				var mapOptions = {
					center: HOME,
					zoom: START_ZOOM,
					streetViewControl: false
				}
				resolve(new google.maps.Map(stopMap.get(0), mapOptions))
			} catch (e) {
				reject(e)
			}
		})
	}

	function makeStopMarkers(stops, map) {

		return new Promise(function(resolve, reject) {

			var markers = []

			stops.forEach(function (stop) {

				if (stop.coords.etrs89) {

					var coord = new google.maps.LatLng(stop.coords.etrs89.latitude, stop.coords.etrs89.longitude)
					var marker = new google.maps.Marker({
						position: coord,
						map: map,
						title: stop.Stop_Name
					})
					var infoWindow = new google.maps.InfoWindow({content: stop.Stop_Name});

					google.maps.event.addListener(marker, "mouseover", function() {
						infoWindow.open(map, marker)
					})

					google.maps.event.addListener(marker, "mouseout", function() {
						infoWindow.close()
					})

					google.maps.event.addListener(marker, "click", function() {
						stopCodeInput.val(stop.Stop_Code_LBSL)
					})

					markers.push(marker)

				}

			})

			return resolve(markers)

		})

	}

	function centreMapOn(map, coords) {
		return new Promise(function(resolve, reject) {
			resolve(map.panTo(new google.maps.LatLng(coords.latitude, coords.longitude)))
		})
	}

	function getCurrentPosition() {
		return new Promise(function(resolve, reject) {
			try {
				navigator.geolocation.getCurrentPosition(function (position) {
					resolve(position)
				})
			} catch (e) {
				reject(e)
			}
		})
	}

})
