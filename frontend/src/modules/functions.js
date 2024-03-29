function dynamicSort(property) {
    var sortOrder = 1;
    if(property[0] === "-") {
        sortOrder = -1;
        property = property.substr(1);
    }
    return function (a,b) {
        /* next line works with strings and numbers, 
         * and you may want to customize it to your needs
         */
        var result = (a[property] < b[property]) ? -1 : (a[property] > b[property]) ? 1 : 0;
        return result * sortOrder;
    }
}

function dynamicSortDesc(property) {
    var sortOrder = 1;
    if(property[0] === "-") {
        sortOrder = -1;
        property = property.substr(1);
    }
    return function (a,b) {
        /* next line works with strings and numbers, 
         * and you may want to customize it to your needs
         */
        var result = (a[property] > b[property]) ? -1 : (a[property] < b[property]) ? 1 : 0;
        return result * sortOrder;
    }
}

function msToTime(s) {

    // Pad to 2 or 3 digits, default is 2
    function pad(n, z) {
      z = z || 2;
      return ('00' + n).slice(-z);
    }
  
    var ms = s % 1000;
    s = (s - ms) / 1000;
    var secs = s % 60;
    s = (s - secs) / 60;
    var mins = s % 60;
    var hrs = (s - mins) / 60;
  
    if (hrs != 0)
        return pad(hrs,hrs>99? 3:2) + ' hours ' + pad(mins) + ' minutes ' + pad(secs) + ' seconds';
    if (mins != 0)
        return pad(mins) + ' minutes ' + pad(secs) + ' seconds';
    return pad(secs) + ' seconds';
}

function msToFullTime(ms) {
    var seconds = ms > 0 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000),
    minutes = seconds > 0 ? Math.floor(seconds / 60) : Math.ceil(seconds / 60),
    hours   = minutes > 0 ? Math.floor(minutes / 60) : Math.ceil(minutes / 60),
    days    = hours > 0 ? Math.floor(hours / 24) : Math.ceil(hours / 24),
    months  = days > 0 ? Math.floor(days / 30) : Math.ceil(days / 30),
    years   = days > 0 ? Math.floor(days / 365) : Math.ceil(days / 365);
    seconds %= 60;
    minutes %= 60;
    hours %= 24;
    days %= 30;
    months %= 12;
    var str = ''
    if (years != 0)
        if (years > 1)
            str += years + ' years'
        else
            str += years + ' year'
    if (months != 0)
        if (months > 1)
            str += ' ' + months + ' months'
        else
            str += ' ' + months + ' month'
    if (days != 0)
        if (days > 1)
            str += ' ' + days + ' days'
        else
            str += ' ' + days + ' day'

    if (str == '')
        str = `${hours} hours ${minutes} minutes ${seconds} seconds`

    return str.trim();
}

function getRandomColor() {
    var letters = '0123456789abcdef';
    var color = '#';
    for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function embedScore(text) {
    return text.replaceAll('_','\\_')
}

function convertUpper(str) {
    return str.replace(/_/g, " ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())
}

function lowerAndScore(str) {
    return str.toLowerCase().replace(/ /g, '_')
}

function getTodayStartMs() {
    return new Date(new Date().setHours(0,0,0,0)).getTime()
}
function getWeekStartMs() {
    const date = new Date();
    date.setHours(0,0,0,0)
    var day = date.getDay() || 7;  
    if( day !== 1 ) 
        date.setHours(-24 * (day - 1)); 
    return date.getTime();
}
function getMonthStartMs() {
    return new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 1)).getTime()
}

function calcArrAvg(arr) {
    var sum = 0
    arr.forEach(value => {
        sum += value
    })
    return sum / arr.length
}

module.exports = {dynamicSort,dynamicSortDesc,msToTime,msToFullTime,getRandomColor,embedScore,convertUpper,lowerAndScore,getTodayStartMs,getWeekStartMs,getMonthStartMs,calcArrAvg};