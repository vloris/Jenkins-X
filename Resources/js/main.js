/**
 * @author Massimiliano Marcon
 */


(function($){
    var J,
    _statusBar,
    _settings,
    _tray,
    _TrayMenu,
    _initDOMStuff,
    _attachEvents,
    _initTrayIcon,
    _setBadge,
    _setBadgeIcon,
    _showNotification, _n,
    _updateStatusBar,
    _cleanStatusBar,
    _loadBuildStatusForJob,
    _loadInfoForJob,
    _jobStatus = {},
    _determineGlobalStatus,
    _currentStatus,
    _schedulerReferences = {},
    that,
    
    JK_XML_API_URL = '/api/xml',
    JK_STATUS = {
        success: 'SUCCESS',
        failure: 'FAILURE',
        inactive: 'INACTIVE',
        building: 'BUILDING'
    },
    JK_SETTINGS,
    JK_MIN_POLLING_TIME = 10000,
    
    JenkinsX = function(){
        //Init
        that = this;
        _currentStatus = JK_STATUS.inactive;
        _initDOMStuff();
        JK_SETTINGS = that.loadSettings();
        _initTrayIcon();
        //Get/parse/show data
        this.scheduleJobMonitoring();
        setInterval(_determineGlobalStatus, 2000);
    };
    
    _TrayMenu = [
        {label: 'Quit JenkinsX', callback: function(){
            Titanium.App.exit();
        }}
    ];
    
    J = JenkinsX.prototype;
    
    J.saveSettings = function(settings, success, error){
        if (!settings.url || !settings.jobs || settings.jobs.length === 0) {
            if (typeof error === 'function') {
                error('Missing parameter in settings');
            }
            return;
        }
        else {
            JK_SETTINGS = settings;
            //Save settings permanently
            Titanium.App.Properties.setString("url", settings.url);
            Titanium.App.Properties.setList("jobs", settings.jobs);
            Titanium.App.Properties.setInt("pollingtime", settings.pollingTime);
            Titanium.App.Properties.setInt("healthdangerthreshold", settings.healthDangerThreshold);
            _n('Settings saved!');
            this.rescheduleJobMonitoring();
        }
    };
    
    J.loadSettings = function(success){
        var settings = {};
        settings.url = Titanium.App.Properties.getString('url', 'default.host.com');
        settings.jobs = Titanium.App.Properties.getList('jobs', 'Jenkins_Job_Name');
        settings.pollingTime = Titanium.App.Properties.getInt('pollingtime', 10000);
        settings.healthDangerThreshold = Titanium.App.Properties.getInt("healthdangerthreshold", 60);
        return settings;
    };
    
    J.exportSettings = function(path, success){
    	Titanium.App.Properties.saveTo(path);
    };
    
    J.importSettings = function(path, success){
    	var properties, settings = {};
    		
    	properties = Titanium.App.loadProperties(path); //This method is not in the Object it is supposed to be in!
    	
    	settings.url = properties.getString('url', 'default.host.com');
    	settings.jobs = properties.getList('jobs', 'Jenkins_Job_Name');
    	settings.pollingTime = properties.getInt('pollingtime', 10000);
    	settings.healthDangerThreshold = properties.getInt('healthdangerthreshold', 60);
    	
    	this.saveSettings(settings);
    	
    	if (JK_SETTINGS.url) {
            $('#jenkinsUrl').val(JK_SETTINGS.url);
            $('#jobs').val(JK_SETTINGS.jobs.join(','));
            $('#polling-time').val(JK_SETTINGS.pollingTime / 1000);
            $('#health-danger-th').val(JK_SETTINGS.healthDangerThreshold);
        }
    };
    
    J.scheduleJobMonitoring = function(){
    	var poller = function(job){
        	_schedulerReferences [job] = setTimeout(_loadBuildStatusForJob, JK_SETTINGS.pollingTime || JK_MIN_POLLING_TIME, job, null, function(){poller(job);});
        }, infoPoller = function(job){
        	_schedulerReferences [job + '-health'] = setTimeout(_loadInfoForJob, (JK_SETTINGS.pollingTime || JK_MIN_POLLING_TIME) * 1, job, null, function(){infoPoller(job);});
        };
        
        JK_SETTINGS.jobs.forEach(function(job){
        	var dt, dd;
        	$('.monitor').append($('<span>').attr('id', job).addClass('inactive').text(job.replace(/_/g, ' ')).data('url', JK_SETTINGS.url + job + '/lastBuild'));
        	dt = $('<dt>').attr('id', job + '-health').text(job.replace(/_/g, ' ')).data('url', JK_SETTINGS.url + job);
        	dd = $('<dd>').attr('rel', job + '-health').addClass('progress').append('<div class="bar" />');
        	$('.health').append(dt).append(dd);
        	
        	_jobStatus [job] = JK_STATUS.inactive;
        	poller(job);
        	infoPoller(job);
        });
    };
    
    J.descheduleJobMonitoring = function(){
    	var job;
    	$('.monitor').empty();
    	$('.health').empty();
    	for (job in _schedulerReferences) {
    		if (_schedulerReferences.hasOwnProperty(job) && _schedulerReferences[job]) {
    			clearTimeout(_schedulerReferences[job]);
    			clearTimeout(_schedulerReferences[job + '-health']);
    		}
    	}
    	_jobStatus = {};
    };
    
    J.rescheduleJobMonitoring = function(){
    	this.descheduleJobMonitoring();
    	this.scheduleJobMonitoring();
    };
    
    _initDOMStuff = function(){
        _statusBar = $('.status-bar');
        _settings = $('.jenkins-x-settings');
        
        _attachEvents();
    };
    
    _attachEvents = function(){
        $('#settings-submit').on('click', function(e){
            var settings = {}, pollingTime;
            
            pollingTime = parseInt($('#polling-time').val(), 10);
            pollingTime = Math.min (Math.max(pollingTime, 1), 60); //between 1 and 60 seconds
            $('#polling-time').val(pollingTime);
            
            settings.url = $('#jenkinsUrl').val();
            settings.jobs = $('#jobs').val().replace(/\s+/g, '').split(',');
            settings.pollingTime = pollingTime * 1000;
            settings.healthDangerThreshold = parseInt($('#health-danger-th').val(), 10);
            that.saveSettings(settings);
            return false;
        });
        
        $('#settings-export').on('click', function(e){
            Titanium.UI.openSaveAsDialog(function(file){ //This method is not in the Object it is supposed to be in!
            	if (file && file[0]) {
            		that.exportSettings(file[0]);
            	}
            }, {
            	title: "Save properties...",
		        types: ['properties'],
		        defaultFile: "jenkins-x.properties",
		        multiple: false,
		        path: Titanium.Filesystem.getDesktopDirectory().nativePath()
            });
            return false;
        });
        
        $('#settings-import').on('click', function(e){
            Titanium.UI.openFileChooserDialog(function(file){ //This method is not in the Object it is supposed to be in!
            	if (file && file[0]) {
            		that.importSettings(file[0]);
            	}
            }, {
            	title: "Choose propery file...",
		        types: ['properties'],
		        multiple: false,
		        path: Titanium.Filesystem.getDesktopDirectory().nativePath()
            });
            return false;
        });

        $('a[data-toggle="tab"]').on('shown', function(e){
            if (e.target.hash === '#settings' && JK_SETTINGS.url) {
                $('#jenkinsUrl').val(JK_SETTINGS.url);
                $('#jobs').val(JK_SETTINGS.jobs.join(','));
                $('#polling-time').val(JK_SETTINGS.pollingTime / 1000);
                $('#health-danger-th').val(JK_SETTINGS.healthDangerThreshold);
            }
        });
        
        $(document).on('click', '.monitor span', function(e){
            var url = $(this).data('url');
            if (url) {
                Titanium.Platform.openURL(url);
            }
        });
    };
    
    _initTrayIcon = function(trayIconCallback){
        var menu = Titanium.UI.createMenu();
        _tray = Titanium.UI.addTray('app://images/gray.png', trayIconCallback || function(){});
        _TrayMenu.forEach(function(val){
            var item = Titanium.UI.createMenuItem(val.label, val.callback);
            menu.appendItem(item);
        });
        _tray.setMenu(menu);
    };
    
    _setBadge = function(string){
        Titanium.UI.setBadge(string);
    };
    
    _n = _showNotification = function(message, show){
        var notification = Titanium.Notification.createNotification({
            title: Titanium.App.getName(),
            message: message,
            timeout: 10,
            icon: 'app://images/notification_icon.png'
        });
        if (!show || !!show === true) {
            notification.show();
        }
        return notification;
    };
    
    _updateStatusBar = function(text){
        _statusBar.text(text);
    };
    
    _cleanStatusBar = function(){
        _updateStatusBar('');
    };
    
    _loadBuildStatusForJob = function(job, buildNumber, onload){
        buildNumber = buildNumber || 'lastBuild';
        var url = JK_SETTINGS.url + job + '/' + buildNumber + JK_XML_API_URL,
            loader = Titanium.Network.createHTTPClient();
        _updateStatusBar('Contacting ' + url);
        loader.onload = function(){
            var r = this.responseText,
                pResponse = {}, result, building, $r = $(r);
            if (r && r.length > 0) {
            	result = $r.find('result');
            	building = $r.find('building');
	            pResponse.success = (result.length > 0 && result.text() === JK_STATUS.success) ? true : false;
	            pResponse.building = (building.length > 0 && building.text() === 'true') ? true : false;
	            _cleanStatusBar('');
	            if (result.length > 0) {
		            if (!pResponse.success) {
		            	$('#' + job).removeClass('green inactive building').addClass('red');
		                _jobStatus [job] = JK_STATUS.failure;
		                //_setBadge('!');
		            }
		            else {
		            	$('#' + job).removeClass('red inactive building').addClass('green');
		                _jobStatus [job] = JK_STATUS.success;
		            }
		        }
		        if (pResponse.building) {
		        	$('#' + job).removeClass('red green inactive').addClass('building');
		        	_jobStatus [job] = JK_STATUS.building;
		        }
	            if (typeof onload === 'function') {
	                onload();
	            }
	            $r.remove();
	            delete result;
	            delete building;
	            delete $r;
	    	}
        };
        loader.onreadystatechange = function(){
        	if (this.readyState === 4) {
        		$('#' + job).removeClass('red green building').addClass('inactive');
        		_jobStatus [job] = JK_STATUS.inactive;
        	}
        };
        loader.open("GET", url);
        loader.send();
        loader = null;
    };
    
    _loadInfoForJob = function(job, onload){
    	var url = JK_SETTINGS.url + job + '/' + JK_XML_API_URL,
            loader = Titanium.Network.createHTTPClient();
        _updateStatusBar('Contacting ' + url);
        loader.onload = function(){
            var r = this.responseText,
                healthReport = {}, $r = $(r), $h, tmp, $element;
            if (r && r.length > 0) {
            	$h = $r.find('healthReport');
            	tmp = [];
            	$h.children('description').each(function(){
            		tmp.push($(this).text());
            	});
            	healthReport.description = tmp.join(',');
            	delete tmp;
            	healthReport.score = parseInt($h.eq(0).children('score').eq(0).text(), 10);
            	$element = $('.health dd[rel="'+job+'-health"]');
            	if (healthReport.score < JK_SETTINGS.healthDangerThreshold) {
            		$element.addClass('progress-danger');
            	}
            	else {
            		$element.removeClass('progress-danger');
            	}
            	$element.children('.bar').css('width', healthReport.score + '%');
	            if (typeof onload === 'function') {
	                onload();
	            }
	            $h.remove();
	            $r.remove();
	            delete result;
	            delete building;
	            delete $r;
	            delete $h;
	    	}
        };
        loader.open("GET", url);
        loader.send();
        loader = null;
    };
    
    _determineGlobalStatus = function(){
    	var globalStatus, job, val;
    	
    	for (job in _jobStatus) {
    		if (_jobStatus.hasOwnProperty(job)) {
    			val = _jobStatus[job];
    			if (val === JK_STATUS.success) {
					if (!globalStatus || globalStatus === JK_STATUS.success) {
						//Only success if it's the first iteration
						//or everytning analyzed so far is success
						globalStatus = JK_STATUS.success;	
					}
				}
				else if (val === JK_STATUS.failure) {
					//Has priority over success, not over inactive
					if (!globalStatus
						|| globalStatus === JK_STATUS.success 
						|| globalStatus === JK_STATUS.failure) {
						globalStatus = JK_STATUS.failure;
					}
	    		}
	    		else if (val === JK_STATUS.building) {
	    			//Building jobs do not alter the global status, unless current status is red
	    			if (_currentStatus = JK_STATUS.failure) {
	    				globalStatus = JK_STATUS.failure;
	    			}
	    			continue;
	    		}
	    		else {
	    			//Uhmm... JK_STATUS.inactive
	    			//this has priority, something
	    			//is not working properly,
	    			//e.g. no connectivity
	    			globalStatus = JK_STATUS.inactive;
	    			break;
	    		}
    		}
    	}
    	
    	switch (globalStatus) {
    		case JK_STATUS.inactive:
    			_tray.setIcon('app://images/gray.png');
    			break;
    		case JK_STATUS.success:
    			_tray.setIcon('app://images/green.png');
    			break;
    		case JK_STATUS.failure:
    			_tray.setIcon('app://images/red.png');
    			break;
    	}
    	//If status changes, notify
    	if (_currentStatus !== globalStatus) {
    		_currentStatus = globalStatus;
    		_n('Build status changed to: ' + _currentStatus);
    	}
    };
    
    window.JenkinsX = JenkinsX;
})(jQuery);

$(document).ready(function(){
    new JenkinsX();
});
