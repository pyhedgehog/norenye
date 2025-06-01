jspatch = sed -re "s/'(fs|querystring)';/'\\1.js';/;s/^\#!.*$$/import process from 'process.js';/" $< > $@
njs_files = cmd.js conftest.js norenye.js norenye_config.js norenye_utils.js
qjs_files = fs.js process.js querystring.js

all: norenye_cmd
clean:
	rm -f norenye_cmd $(njs_files)

#%.js: ../js/%.js
norenye_cmd: $(njs_files) $(qjs_files) Makefile
	qjsc -o norenye_cmd -D std -D os -m cmd.js

cmd.js: ../js/cmd.js Makefile
	$(jspatch)

conftest.js: ../js/conftest.js Makefile
	$(jspatch)

norenye.js: ../js/norenye.js Makefile
	$(jspatch)

norenye_config.js: ../js/norenye_config.js Makefile
	$(jspatch)

norenye_utils.js: ../js/norenye_utils.js Makefile
	$(jspatch)
