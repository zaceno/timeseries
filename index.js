var TimeSeries = function (data) {
    if (!(this instanceof TimeSeries)) return new TimeSeries(data);
    if (data instanceof TimeSeries) return new TimeSeries(data._data);
    this._data = TimeSeries._sort(data);
    this.length = this._data.length;
};
TimeSeries._sorter = function (l, r) { return l[0] - r[0]; };
TimeSeries._sort = function (data) {return data.sort(TimeSeries._sorter); };
TimeSeries.prototype.data = function () { return this._data; };
TimeSeries.prototype.interpolate = function (ts) {
    if (ts.length === 0) return null;
    ts = TimeSeries(ts);
    var ipl = [], //store the final list of interpolated events
        buf = [], //buffer for unknowns to be interpolated
        statfn = function (a, b, c) {
            return [c[0], a[1]];
        },
        //given event c, what is the value using a and b as interpolation points
        linfn = function (a, b, c) {
            return [c[0], ((c[0]-a[0]) * (b[1] - a[1]) / (b[0] - a[0]) + a[1])];
        },
        //interpolates all events in the buffer between a, b
        flushBuf = function (a, b) {
            var iplfn = a[0] === b[0] ? statfn : linfn;
            buf.forEach(function (c) {
                ipl.push(iplfn(a, b, c));
            });
            buf = [];
        };
    //remember the last point that was known
    var lastMeasured = null;
    //combine all known and unknown events, and sort on time
    this._data
    .concat(ts._data.map(function (p) { return [p[0], null]; }))
    .sort(TimeSeries._sorter)
    .forEach(function (p) {
        if (p[1] === null) return buf.push(p); //unknowns are buffered
        //if it's the first known, do a static interpolation for the buffer
        //otherwise, linear interpolate between last measurement and this.
        if (!!lastMeasured) {
            flushBuf(lastMeasured, p);
        } else {
            flushBuf(p, p);
        }
        //remember this as the previously known value
        lastMeasured = p;
        ipl.push(p);
    });

    //if by the end, there are still points in the buffer, do a static
    //interpolation of the last known.
    flushBuf(lastMeasured, lastMeasured);
    return new TimeSeries(ipl);
};

TimeSeries.prototype._reduceDoubles = function () {
    var seen;
    return this.filter(function (v, t) {
        if (seen === t) return false;
        seen = t;
        return true;
    });
};


TimeSeries.prototype.max = function () {
    return this.reduce(function (r, v, t, i) {
        if (r === null) return v;
        if (v > r) return v;
        return r;
    }, null);
};

TimeSeries.prototype.min = function () {
    return this.reduce(function (r, v, t, i) {
        if (r === null) return v;
        if (v < r) return v;
        return r;
    }, null);
};

TimeSeries.prototype.starts = function () {
    return this._data[0][0];
};

TimeSeries.prototype.ends = function () {
    return this._data[this._data.length - 1][0];
};

TimeSeries.prototype.interval = function (limstart, limend) {
    return this.filter(function (v, t) {
        return t >= limstart && t <= limend;
    });
};

TimeSeries.prototype.constant = function (v) {
    var m=this.map(function () { return v; });
    return m;
};

TimeSeries.prototype.calculation = function (s2, fn) {
    if (s2.length === 0) return null;
    var s1 = this.interpolate(s2)._reduceDoubles();
    if (!s1) return null;
    s2 = new TimeSeries(s2).interpolate(s1)._reduceDoubles();
    if (s2.length !== s1.length) {
        console.log(s1, s2);
        throw new Error('Series cant be interpolated');
    }
    return s1.map(function (v, t, i) {
        return fn(v, s2._data[i][1]);
    });
};

TimeSeries.prototype.map = function (fn) {
    var self = this;
    return new TimeSeries(this._data.map(function (p, i) {
        return [p[0], fn(p[1], p[0], i,self)];
    }));
};

TimeSeries.prototype.filter = function (fn) {
    var self = this;
    return new TimeSeries(this._data.filter(function (p,i) {
        return fn(p[1], p[0], i, self);
    }));
};

TimeSeries.prototype.reduce = function (fn, initial) {
    var self = this;
    return this._data.reduce(function (r, p, i) {
        return fn(r, p[1], p[0], i, self);
    }, initial);
};


TimeSeries.prototype.forEach = function (fn) {
    var self = this;
    this._data.forEach(function (p,i) {
        return fn(p[1], p[0], i, self);
    });
};

TimeSeries.prototype.getTrend = function () {
    var T = this._data.map(function (p) { return p[0]; });
    var V = this._data.map(function (p) { return p[1]; });
    var meanT  = T.reduce(function (sum, t) { return sum + t}, 0) / T.length;
    var meanV = V.reduce(function (sum, v) { return sum + v}, 0) / V.length;
    var Q = T.map(function (t, i) {
        var v = V[i];
        return (t - meanT) * (v - meanV);
    }).reduce(function (S, q) {
        return S + q;
    }, 0);
    var R = T.map(function (t, i) {
        return (t - meanT) * (t - meanT);
    }).reduce(function (S, r) {
        return S + r;
    }, 0);
    var slope = Q / R;
    var intercept = meanV - meanT * slope;
    var fn = function (t) {
        return t * slope + intercept;
    };
    fn.inv = function (v) {
        return (v - intercept) / slope;
    };
    return fn;
};

TimeSeries.prototype.filterTimes = function (ts) {
    var keep = [];
    var i = 0;
    var j = 0;
    while(i < this._data.length && j < ts.length) {
        t1 = this._data[i][0];
        t2 = ts[j][0];
        if (t2 > t1) i++;
        if (t2 < t1) j++;
        if (t2 === t1) {
            keep.push(this._data[i]);
            j++;
            i++;
        }
    }
    return new TimeSeries(keep);
};

(function (calcs) {
    Object.keys(calcs).forEach(function (name) {
        TimeSeries.prototype[name] = function (s2) {
            return this.calculation(s2, calcs[name]);
        };
    });
})({
   add: function (a, b) {return a + b},
   sub: function (a, b) {return a - b},
   mul: function (a, b) {return a * b},
   div: function (a, b) {return a / b}
});

module.exports = TimeSeries;
