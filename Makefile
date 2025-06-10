build:
	poetry run scripts/readme2tests.py -q
	docker build -q -t norenye-test:manual .

clean:
	-rm -rf .pytest_assist .pytest_cache coverage/pytest-junit.html
	-docker rm -f norenye_pytest
	-rm -f tests/nginx/*.gen-*

fasttest:
	poetry run pytest -qm 'fast and not slow'

test:
	poetry run pytest -qm 'not slow'

fulltest:
	poetry run pytest -q

gen: coverage/pytest-junit.html

coverage/pytest-junit.html: coverage/pytest.junit
	poetry run junit2html $< $@
