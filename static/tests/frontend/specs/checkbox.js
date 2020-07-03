describe('test settingToCheckbox, which creates checkboxes that are linked to to urlVars and cookies', function() {
  before(function(done) {
    this.timeout(60000);
    helper.newPad({
      padPrefs: {
        rtcEnabled: true,
        fakeWebrtcFirefox: true,
        cookie3: true,
        cookie4: false,
        cookie5: false,
        cookie6: true,
      },
      cb: function () {
        var chrome$
        chrome$ = helper.padChrome$;
        chrome$.window.ep_webrtc.setUrlParamString("?urlVar5=true&urlVar6=false")
        helper.waitFor(function(){
          chrome$ = helper.padChrome$; // get it again, since we refreshed the page
          return chrome$ && chrome$("#rtcbox video").length === 1;
        }, 1000).done(done)
      }
    });
  });

  it('sets up checkboxes with values set by urlVar, cookie and site-wide default', function(done) {
    var chrome$ = helper.padChrome$;

    chrome$("<input type='checkbox' id='checkboxId1'>").appendTo("#settings")
    chrome$("<input type='checkbox' id='checkboxId2'>").appendTo("#settings")
    chrome$("<input type='checkbox' id='checkboxId3'>").appendTo("#settings")
    chrome$("<input type='checkbox' id='checkboxId4'>").appendTo("#settings")
    chrome$("<input type='checkbox' id='checkboxId5'>").appendTo("#settings")
    chrome$("<input type='checkbox' id='checkboxId6'>").appendTo("#settings")

    helper.waitFor(function(){
      chrome$ = helper.padChrome$;
      return (chrome$ &&
        chrome$("#checkboxId1").length === 1 &&
        chrome$("#checkboxId2").length === 1 &&
        chrome$("#checkboxId3").length === 1 &&
        chrome$("#checkboxId4").length === 1 &&
        chrome$("#checkboxId5").length === 1 &&
        chrome$("#checkboxId6").length === 1
      )
    }, 1000).done(function() {

      // based on defaultVal set to true
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar1", // not set
        cookie: "cookie1", // not set
        defaultVal: true,
        checkboxId: "#checkboxId1"
      })

      // based on defaultVal set to false
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar2", // not set
        cookie: "cookie2", // not set
        defaultVal: false,
        checkboxId: "#checkboxId2"
      })

      // based on cookie set to true
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar3", // not set
        cookie: "cookie3",
        defaultVal: false, // cookie should override this
        checkboxId: "#checkboxId3"
      })

      // based on cookie set to false
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar4", // not set
        cookie: "cookie4",
        defaultVal: true, // cookie should override this
        checkboxId: "#checkboxId4"
      })

      // based on urlVar set to true
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar5",
        cookie: "cookie5", // urlVar should override this
        defaultVal: false, // urlVar should override this
        checkboxId: "#checkboxId5"
      })

      // based on urlVar set to false
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar6",
        cookie: "cookie6", // urlVar should override this
        defaultVal: true, // urlVar should override this
        checkboxId: "#checkboxId6"
      })

      expect(chrome$('#checkboxId1').prop("checked")).to.equal(true)
      expect(chrome$('#checkboxId2').prop("checked")).to.equal(false)
      expect(chrome$('#checkboxId3').prop("checked")).to.equal(true)
      expect(chrome$('#checkboxId4').prop("checked")).to.equal(false)
      expect(chrome$('#checkboxId5').prop("checked")).to.equal(true)
      expect(chrome$('#checkboxId6').prop("checked")).to.equal(false)

      // Confirm that the urlVars set the cookies
      expect(chrome$.window.document.cookie.indexOf("cookie5%22%3Atrue")).to.not.equal(-1)
      expect(chrome$.window.document.cookie.indexOf("cookie6%22%3Afalse")).to.not.equal(-1)

      chrome$('#checkboxId1').click()
      chrome$('#checkboxId2').click()
      chrome$('#checkboxId3').click()
      chrome$('#checkboxId4').click()
      chrome$('#checkboxId5').click()
      chrome$('#checkboxId6').click()

      // Check that clicking flips the cookies along with the switches themselves
      helper.waitFor(function(){
        chrome$ = helper.padChrome$;
        return (chrome$ &&
          chrome$("#checkboxId1").prop("checked") === false &&
          chrome$("#checkboxId2").prop("checked") === true &&
          chrome$("#checkboxId3").prop("checked") === false &&
          chrome$("#checkboxId4").prop("checked") === true &&
          chrome$("#checkboxId5").prop("checked") === false &&
          chrome$("#checkboxId6").prop("checked") === true
        )
      }, 1000).done(function() {
        expect(chrome$.window.document.cookie.indexOf("cookie1%22%3Afalse")).to.not.equal(-1)
        expect(chrome$.window.document.cookie.indexOf("cookie2%22%3Atrue")).to.not.equal(-1)
        expect(chrome$.window.document.cookie.indexOf("cookie3%22%3Afalse")).to.not.equal(-1)
        expect(chrome$.window.document.cookie.indexOf("cookie4%22%3Atrue")).to.not.equal(-1)
        expect(chrome$.window.document.cookie.indexOf("cookie5%22%3Afalse")).to.not.equal(-1)
        expect(chrome$.window.document.cookie.indexOf("cookie6%22%3Atrue")).to.not.equal(-1)
        done()
      })
    });
  });

  it('throws errors for missing params', function(done) {
    var chrome$ = helper.padChrome$;

    try {
      chrome$.window.ep_webrtc.settingToCheckbox({
        cookie: "cookie",
        defaultVal: true,
        checkboxId: "#checkboxId"
      })
      done(Error("expected error message for missing urlVar"))
      return
    }
    catch (err) {
      expect(err.message).to.contain('urlVar')
    }

    try {
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar",
        defaultVal: true,
        checkboxId: "#checkboxId"
      })
      done(Error("expected error message for missing cookie"))
      return
    }
    catch (err) {
      expect(err.message).to.contain('cookie')
    }

    try {
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar",
        cookie: "cookie",
        checkboxId: "#checkboxId"
      })
      done(Error("expected error message for missing defaultVal"))
      return
    }
    catch (err) {
      expect(err.message).to.contain('defaultVal')
    }

    try {
      chrome$.window.ep_webrtc.settingToCheckbox({
        urlVar: "urlVar",
        cookie: "cookie",
        defaultVal: true,
      })
      done(Error("expected error message for missing checkboxId"))
      return
    }
    catch (err) {
      expect(err.message).to.contain('checkboxId')
    }

    done()
  });
})
